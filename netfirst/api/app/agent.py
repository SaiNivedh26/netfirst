"""Invoice agent (agno + Groq): PDF in, PayPal draft out.

The model reads, plans, chooses and explains. Tools do every calculation and PayPal call, and never take
amounts from the model: price_invoice computes them and create_paypal_draft uses only that result.
Sending is not a tool; only the Approve endpoint sends.
"""
import difflib
import io
import json
import re
import threading
import time
from datetime import UTC, date, datetime
from pathlib import Path

from agno.agent import Agent
from agno.models.groq import Groq
from agno.tools import Toolkit
from pydantic import BaseModel, ValidationError
from pypdf import PdfReader
from sqlmodel import Session, select

from . import paypal
from .config import env
from .fx import balance, fmt, is_currency, price_invoice, to_minor
from .ledger import allowed_treatment, client_entries, new_client, refresh_proposals, sent_entries
from .models import AgentRun, Client, Invoice, engine, get_settings, now
from .rates import quote

EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

INSTRUCTIONS = """You prepare cross-border PayPal invoices for a freelancer, from the text of their own invoice PDF.
Always follow these steps in order:
1. Extract every field and call validate_extraction FIRST, before anything else. Amounts are strings in major units exactly as written.
   Missing optional fields (email, country, due date, tax) are null. Use the ISO code of the currency the work is priced in.
2. Call find_client.
3. If there is no match, the client's email is essential: if the PDF has none, call ask_user for it. Then call propose_client;
   the client's currency is the currency on the invoice unless the user said otherwise.
4. Call get_client_history.
5. Call price_invoice with the output currency (the user's choice if given, else the client's usual currency) and your treatment choice.
   CHARGE: new or slow-paying clients. TRUE_UP: repeat clients. DEFER: loyal clients only.
6. Call check_policy for that treatment. If it downgrades, call price_invoice again with the allowed treatment.
7. Call create_paypal_draft with a one-sentence reason for the treatment that the client could read.
Only the client email and an unambiguous currency are essential. A missing due date is fine (the default payment term applies).
Never compute, convert or invent amounts, emails or currencies. If validate_extraction fails twice, call ask_user instead of guessing."""


class Item(BaseModel):
    name: str
    amount: str


class Extraction(BaseModel):
    invoice_number: str | None = None
    client_name: str
    client_email: str | None = None
    client_country: str | None = None
    currency: str
    items: list[Item]
    tax: str | None = None
    total: str
    due_date: date | None = None


def pdf_text(data: bytes) -> str:
    return "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(data)).pages).strip()


def _out(summary: str, **data) -> str:
    """Tools return JSON for the model with a human summary that the trace shows."""
    return json.dumps({"summary": summary, **data}, default=str)


class InvoiceTools(Toolkit):
    def __init__(self, run_id: str, output_currency: str | None = None):
        self.run_id, self.requested_output = run_id, output_currency
        self.extraction: Extraction | None = None
        self.client_id: str | None = None
        self.priced: dict | None = None
        super().__init__(
            name="invoice_tools",
            tools=[self.validate_extraction, self.find_client, self.propose_client, self.get_client_history,
                   self.get_fx_quote, self.price_invoice, self.check_policy, self.create_paypal_draft, self.ask_user],
            stop_after_tool_call_tools=["create_paypal_draft", "ask_user"],
        )

    def validate_extraction(self, extraction_json: str) -> str:
        """Validate the fields you extracted from the PDF.

        Args:
            extraction_json: JSON object with invoice_number, client_name, client_email, client_country, currency (ISO 4217),
                items (list of {name, amount}), tax (null if none), total, due_date (YYYY-MM-DD). Amounts are strings in major units.
        """
        try:
            ex = Extraction.model_validate_json(extraction_json)
        except ValidationError as e:
            return _out("Extraction is not valid JSON for the schema", ok=False, errors=e.errors(include_url=False))
        errors = []
        if not is_currency(ex.currency):
            errors.append(f"{ex.currency} is not an ISO 4217 currency code")
        if ex.client_email and not EMAIL.match(ex.client_email):
            errors.append(f"{ex.client_email} is not an email address")
        if not errors:
            try:
                items = sum(to_minor(i.amount.replace(",", ""), ex.currency) for i in ex.items)
                tax = to_minor(ex.tax.replace(",", ""), ex.currency) if ex.tax else 0
                total = to_minor(ex.total.replace(",", ""), ex.currency)
                if items + tax != total:
                    errors.append(f"items {fmt(items, ex.currency)} + tax {fmt(tax, ex.currency)} do not add up to the total {fmt(total, ex.currency)}")
            except ArithmeticError:
                errors.append("an amount is not a number")
        if errors:
            return _out("Validation failed: " + "; ".join(errors), ok=False, errors=errors)
        self.extraction = ex
        with Session(engine) as s:
            run = s.get(AgentRun, self.run_id)
            run.extracted = ex.model_dump_json()
            s.add(run)
            s.commit()
        return _out(f"{len(ex.items)} items" + (f" + tax {ex.tax}" if ex.tax else "") + f" add up to {ex.currency} {ex.total}", ok=True)

    def find_client(self, name: str, email: str | None = None) -> str:
        """Match the invoice's client to an existing NetFirst client by email, then by name.

        Args:
            name: Client name from the invoice.
            email: Client email from the invoice, if any.
        """
        with Session(engine) as s:
            clients = s.exec(select(Client)).all()
            match = next((c for c in clients if email and c.email.lower() == email.lower()), None)
            if match is None:
                names = {c.name.lower(): c for c in clients}
                close = difflib.get_close_matches(name.lower(), names, n=1, cutoff=0.8)
                match = names[close[0]] if close else None
            if match is None:
                return _out(f"No existing client matches {name}", found=False)
            self.client_id = match.id
            return _out(f"Matched {match.name} ({match.currency or 'no usual currency'})", found=True, client=match.model_dump())

    def propose_client(self, name: str, email: str, country: str, currency: str) -> str:
        """Add a new client (the user confirms it when approving the draft).

        Args:
            name: Client name.
            email: Client email; PayPal sends the invoice here.
            country: ISO 3166 alpha-2 country code.
            currency: ISO 4217 code the client pays in; must be one PayPal can invoice in.
        """
        if not EMAIL.match(email):
            return _out(f"{email} is not an email address", ok=False)
        if not is_currency(currency):
            return _out(f"{currency} is not an ISO 4217 currency code", ok=False)
        with Session(engine) as s:
            c = new_client(s, name=name, email=email, country=country.upper(), currency=currency)
            self.client_id = c.id
            return _out(f"New client {c.name} paying in {currency}", ok=True, client=c.model_dump())

    def get_client_history(self) -> str:
        """Paid invoices, average days to pay, FX balance, cap and pending credit for the matched client."""
        if not self.client_id:
            return _out("Call find_client or propose_client first", ok=False)
        with Session(engine) as s:
            c, base = s.get(Client, self.client_id), get_settings(s).base_currency
            paid = s.exec(select(Invoice).where(Invoice.client_id == c.id, Invoice.status == "PAID")).all()
            days = [(i.paid_at - i.created_at).days for i in paid if i.paid_at]
            bal = balance(client_entries(s, c.id))
            avg = round(sum(days) / len(days)) if days else None
            return _out(
                f"{len(paid)} paid invoices" + (f", pays in about {avg} days" if avg is not None else "") + f", FX balance {fmt(bal, base)}",
                paid_invoices=len(paid), avg_days_to_pay=avg, balance=fmt(bal, base), cap=fmt(c.cap_minor_base, base),
                pending_credit=fmt(-bal, base) if bal < 0 else None, usual_currency=c.currency,
            )

    def get_fx_quote(self, from_currency: str, to_currency: str) -> str:
        """Exchange rate for any currency pair (units of to_currency per 1 from_currency).

        Args:
            from_currency: ISO 4217 code.
            to_currency: ISO 4217 code.
        """
        q = quote(from_currency, to_currency)
        return _out(f"1 {from_currency} = {q.rate} {to_currency} ({q.source}, {q.date})", rate=str(q.rate), source=q.source)

    def price_invoice(self, output_currency: str, treatment: str) -> str:
        """Price the validated invoice in the output currency. Computes the work amount, FX line, total and any credit discount.

        Args:
            output_currency: ISO 4217 code the client will be invoiced in.
            treatment: CHARGE, TRUE_UP or DEFER.
        """
        if not self.extraction or not self.client_id:
            return _out("Validate the extraction and match a client first", ok=False)
        if treatment not in ("CHARGE", "TRUE_UP", "DEFER"):
            return _out(f"Unknown treatment {treatment}", ok=False)
        ex, out = self.extraction, self.requested_output or output_currency
        with Session(engine) as s:
            st = get_settings(s)
            base, bal = st.base_currency, balance(client_entries(s, self.client_id))
        so, ob = quote(ex.currency, out), quote(out, st.base_currency)
        source_minor = to_minor(ex.total.replace(",", ""), ex.currency)
        r = price_invoice(source_minor=source_minor, source=ex.currency, output=out, base=base, rate_source_to_output=so.rate,
                          rate_output_to_base=ob.rate, treatment=treatment, fee=st.fee_pct, spread=st.spread_pct,
                          credit_base_minor=max(-bal, 0))
        self.priced = r | {"source_minor": source_minor, "output": out, "base": base, "treatment": treatment,
                           "rate_output_to_base": str(ob.rate), "rate_source": ob.source}
        line = f"{fmt(r['output_base_minor'], out)} + {fmt(r['fx_line_minor'], out)} FX line"
        if r["discount_minor"]:
            line += f" − {fmt(r['discount_minor'], out)} credit"
        return _out(f"{line} = {fmt(r['gross_minor'], out)} ({treatment})", ok=True,
                    total=fmt(r["gross_minor"], out), fx_line=fmt(r["fx_line_minor"], out), deferred_to_balance=fmt(r["defer_base_minor"], base))

    def _policy(self, treatment: str) -> tuple[str, str]:
        with Session(engine) as s:
            c = s.get(Client, self.client_id)
            paid = len(s.exec(select(Invoice).where(Invoice.client_id == c.id, Invoice.status == "PAID")).all())
            return allowed_treatment(treatment, paid, balance(client_entries(s, c.id)), c.cap_minor_base)

    def check_policy(self, treatment: str) -> str:
        """Confirm a treatment against the guardrails, or get the allowed downgrade.

        Args:
            treatment: CHARGE, TRUE_UP or DEFER.
        """
        if not self.client_id:
            return _out("Match a client first", ok=False)
        allowed, why = self._policy(treatment)
        return _out(f"{treatment} allowed" if allowed == treatment else f"{treatment} not allowed ({why}); use {allowed}",
                    allowed=allowed, why=why)

    def create_paypal_draft(self, reason: str) -> str:
        """Create the PayPal DRAFT invoice from the latest price_invoice result. Never sends.

        Args:
            reason: One sentence explaining the treatment, readable by the client.
        """
        p, ex = self.priced, self.extraction
        if not p or not ex:
            return _out("Call price_invoice first", ok=False)
        with Session(engine) as s:
            if s.get(AgentRun, self.run_id).status != "RUNNING":
                return _out("Run is no longer active; no draft created", ok=False)
        allowed, why = self._policy(p["treatment"])
        if allowed != p["treatment"]:
            return _out(f"{p['treatment']} is not allowed ({why}); price again with {allowed}", ok=False)
        with Session(engine) as s:
            c = s.get(Client, self.client_id)
            out = p["output"]
            inv = Invoice(
                client_id=c.id, invoice_number=ex.invoice_number, description=", ".join(i.name for i in ex.items),
                source_minor=p["source_minor"], source_currency=ex.currency, ai_reason=reason, agent_run_id=self.run_id,
                source_file=str(_pdf_path(self.run_id)), output_base_minor=0, output_currency=out, base_currency=p["base"],
                treatment=p["treatment"], rate_invoiced=p["rate_output_to_base"], rate_source=p["rate_source"],
                due_date=datetime(ex.due_date.year, ex.due_date.month, ex.due_date.day, tzinfo=UTC) if ex.due_date else None,
            )
            _fill(inv, p)
            draft = paypal.create_draft(draft_payload(inv, c, ex))
            inv.paypal_invoice_id = draft["id"]
            run = s.get(AgentRun, self.run_id)
            run.status, run.invoice_id = "DRAFT_READY", inv.id
            s.add_all([inv, run])
            s.commit()
            return _out(f"PayPal draft {draft['id']} for {fmt(inv.output_base_minor - inv.discount_minor + inv.fx_line_minor, out)}", ok=True)

    def ask_user(self, question: str) -> str:
        """Pause the run with one question when an essential field is missing or ambiguous.

        Args:
            question: The single question for the user.
        """
        with Session(engine) as s:
            run = s.get(AgentRun, self.run_id)
            run.status, run.question = "NEEDS_INPUT", question
            s.add(run)
            s.commit()
        return _out(f"Asked: {question}")


def draft_payload(inv: Invoice, c: Client, ex: Extraction) -> dict:
    """Work as one line (per-item conversion would not sum to the priced amount after rounding), then the FX line."""
    out = inv.output_currency
    note = f"Rate used: 1 {out} = {inv.rate_invoiced} {inv.base_currency} ({inv.rate_source}, {now().date()})."
    if inv.treatment != "CHARGE":
        note += " Rate changes before payment are settled on your FX statement."
    return paypal.invoice_payload(
        currency=out, email=c.email, note=note, invoice_number=inv.invoice_number, due_date=inv.due_date,
        items=[(inv.description, inv.output_base_minor), ("FX and processing", inv.fx_line_minor)], discount_minor=inv.discount_minor,
    )


def _trace(run_id: str, started: float):
    """agno tool hook: run the tool, append {tool, args, summary, ms} to the run's trace for the UI."""
    def hook(function_name: str, function_call, arguments: dict):
        # agno swallows hook exceptions, so a timeout fails the run in the DB and tells the model to stop.
        if time.monotonic() - started > env.int("AGENT_TIMEOUT_SECONDS"):
            with Session(engine) as s:
                run = s.get(AgentRun, run_id)
                if run.status == "RUNNING":
                    run.status, run.question = "FAILED", "Agent run timed out."
                    s.add(run)
                    s.commit()
            return _out("Run timed out. Stop now and call no more tools.", ok=False)
        t = time.monotonic()
        result = function_call(**arguments)
        try:
            summary = json.loads(result).get("summary", "")
        except (TypeError, ValueError):
            summary = str(result)[:200]
        with Session(engine) as s:
            run = s.get(AgentRun, run_id)
            run.steps = json.dumps([*json.loads(run.steps), {"tool": function_name, "args": arguments, "summary": summary,
                                                             "ms": round((time.monotonic() - t) * 1000), "at_s": round(time.monotonic() - started, 1)}], default=str)
            s.add(run)
            s.commit()
        return result
    return hook


def build_agent(tools: InvoiceTools, run_id: str) -> Agent:
    return Agent(
        model=Groq(id=env.GROQ_MODEL, temperature=float(env.AGENT_TEMPERATURE), timeout=env.int("AGENT_TIMEOUT_SECONDS")),
        instructions=INSTRUCTIONS, tools=[tools], tool_call_limit=env.int("AGENT_TOOL_CALL_LIMIT"),
        tool_hooks=[_trace(run_id, time.monotonic())],
    )


def execute(run_id: str, text: str, output_currency: str | None = None, answer: str | None = None) -> None:
    tools = InvoiceTools(run_id, output_currency)
    prompt = f"Prepare a PayPal invoice for this invoice PDF.\n\n--- PDF TEXT ---\n{text}\n--- END ---"
    if output_currency:
        prompt += f"\nThe user chose {output_currency} as the output currency."
    if answer:
        prompt += (
            f"\nThe user answered your earlier question: {answer}"
            "\nYou have already validated the extraction and matched or created the client."
            " Continue from where you left off: call get_client_history, price_invoice, check_policy, then create_paypal_draft."
            " Do NOT call validate_extraction or find_client again."
        )
    try:
        build_agent(tools, run_id).run(prompt)
        with Session(engine) as s:
            run = s.get(AgentRun, run_id)
            if run.status == "RUNNING":  # model stopped without a draft or a question
                run.status, run.question = "FAILED", "The agent stopped before creating a draft."
                s.add(run)
                s.commit()
    except Exception as e:  # timeout, model or PayPal error: keep the partial trace, offer the manual form
        with Session(engine) as s:
            run = s.get(AgentRun, run_id)
            run.status, run.question = "FAILED", f"{type(e).__name__}: {e}"[:500]
            s.add(run)
            s.commit()


def _pdf_path(run_id: str) -> Path:
    return Path(env.UPLOAD_DIR) / f"{run_id}.pdf"


def start(file_name: str, data: bytes, output_currency: str | None = None) -> str:
    text = pdf_text(data)
    with Session(engine) as s:
        run = AgentRun(file_name=file_name, status="RUNNING" if text else "FAILED",
                       question=None if text else "This PDF has no text layer (scanned image).")
        s.add(run)
        s.commit()
        run_id = run.id
    _pdf_path(run_id).parent.mkdir(parents=True, exist_ok=True)
    _pdf_path(run_id).write_bytes(data)
    if text:
        threading.Thread(target=execute, args=(run_id, text, output_currency), daemon=True).start()
    return run_id


def resume(run_id: str, answer: str, output_currency: str | None = None) -> None:
    """Re-run from the PDF with the user's answer; the tools are idempotent enough to repeat (client matching finds the client)."""
    with Session(engine) as s:
        run = s.get(AgentRun, run_id)
        if run is None or run.status != "NEEDS_INPUT":
            raise ValueError("Run is not waiting for an answer")
        run.status, run.question = "RUNNING", None
        s.add(run)
        s.commit()
    text = pdf_text(_pdf_path(run_id).read_bytes())
    threading.Thread(target=execute, args=(run_id, text, output_currency, answer), daemon=True).start()


def _fill(inv: Invoice, p: dict) -> None:
    """Copy a price_invoice result onto the invoice row."""
    inv.output_currency, inv.base_currency, inv.treatment = p["output"], p["base"], p["treatment"]
    inv.output_base_minor, inv.fx_line_minor = p["output_base_minor"], p["fx_line_minor"]
    inv.discount_minor, inv.defer_base_minor = p["discount_minor"], p["defer_base_minor"]
    inv.rate_invoiced, inv.rate_source = p["rate_output_to_base"], p["rate_source"]


def reprice(run_id: str, output_currency: str | None = None, treatment: str | None = None) -> Invoice:
    """User switched output currency or treatment on a draft: re-price, replace the PayPal draft (drafts were never sent)."""
    with Session(engine) as s:
        run = s.get(AgentRun, run_id)
        inv = s.get(Invoice, run.invoice_id) if run and run.invoice_id else None
        if inv is None or inv.status != "DRAFT":
            raise ValueError("No draft to re-price")
        tools = InvoiceTools(run_id, output_currency or inv.output_currency)
        tools.extraction, tools.client_id = Extraction.model_validate_json(run.extracted), inv.client_id
        wanted = treatment or inv.treatment
        allowed, why = tools._policy(wanted)
        if allowed != wanted:
            raise ValueError(f"{wanted} is not allowed: {why}")
        tools.price_invoice(tools.requested_output, wanted)
        _fill(inv, tools.priced)
        old = inv.paypal_invoice_id
        inv.paypal_invoice_id = paypal.create_draft(draft_payload(inv, s.get(Client, inv.client_id), tools.extraction))["id"]
        s.add(inv)
        s.commit()
        s.refresh(inv)
    paypal.call("DELETE", f"/v2/invoicing/invoices/{old}")
    return inv


def approve(run_id: str) -> Invoice:
    """The only path that sends an invoice."""
    with Session(engine) as s:
        run = s.get(AgentRun, run_id)
        inv = s.get(Invoice, run.invoice_id) if run and run.invoice_id else None
        if inv is None or run.status != "DRAFT_READY":
            raise ValueError("Run has no draft ready to send")
        inv.paypal_url, inv.status, run.status = paypal.send_and_get_link(inv.paypal_invoice_id), "SENT", "SENT"
        s.add_all([inv, run, *sent_entries(inv)])
        s.commit()
        refresh_proposals(s, inv.client_id)
        s.refresh(inv)
        return inv
