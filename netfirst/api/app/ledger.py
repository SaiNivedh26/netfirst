"""Ledger posting rules, treatment guardrails, settle proposals and the payment-day true-up.

Ledger amounts are base-currency minor units: + client owes user, − user owes client.
INVOICE and PAYMENT are informational; the FX balance is TRUE_UP + FX_DEFER + SETTLEMENT + CREDIT_APPLIED.
"""
from datetime import datetime, timedelta

from sqlmodel import Session, select

from . import paypal
from .config import env
from .fx import Rate, balance, convert, fmt, invert, settlement_invoice, to_major, to_minor, true_up_base
from .models import Client, Invoice, LedgerEntry, Proposal, WebhookEvent, get_settings, now
from .rates import Quote, payment_day, quote


# --- posting rules (pure) ---

def total_minor(inv: Invoice) -> int:
    return inv.output_base_minor - inv.discount_minor + inv.fx_line_minor


def sent_entries(inv: Invoice, at: datetime | None = None) -> list[LedgerEntry]:
    out, base, r, at = inv.output_currency, inv.base_currency, inv.rate_invoiced, at or now()
    rows = [("INVOICE", convert(total_minor(inv), out, base, r), f"Invoiced {out} {to_major(total_minor(inv), out)} at {r}")]
    if inv.defer_base_minor:
        rows.append(("FX_DEFER", inv.defer_base_minor, "FX cost carried to balance (DEFER)"))
    if inv.discount_minor:
        rows.append(("CREDIT_APPLIED", convert(inv.discount_minor, out, base, r), "FX credit applied as discount"))
    return [LedgerEntry(client_id=inv.client_id, invoice_id=inv.id, type=t, amount_minor=a, note=n, created_at=at, demo_session_id=inv.demo_session_id) for t, a, n in rows]


def paid_entries(inv: Invoice, rate_paid: Rate, at: datetime | None = None) -> list[LedgerEntry]:
    out, base, r, paid, at = inv.output_currency, inv.base_currency, inv.rate_invoiced, str(rate_paid), at or now()
    rows = [("PAYMENT", convert(total_minor(inv), out, base, paid), f"Paid at {paid}")]
    if inv.treatment != "CHARGE":
        swing = true_up_base(inv.output_base_minor - inv.discount_minor, out, base, r, paid)
        rows.append(("TRUE_UP", swing, f"Rate moved {r} → {paid}"))
    return [LedgerEntry(client_id=inv.client_id, invoice_id=inv.id, type=t, amount_minor=a, note=n, created_at=at, demo_session_id=inv.demo_session_id) for t, a, n in rows]


# --- guardrails (pure) ---

def allowed_treatment(requested: str, paid_count: int, balance_minor: int, cap_minor: int) -> tuple[str, str]:
    """Returns (treatment, why). Downgrades instead of refusing, so the agent always has a valid answer."""
    true_up_min, defer_min = env.int("POLICY_TRUE_UP_MIN_PAID"), env.int("POLICY_DEFER_MIN_PAID")
    if requested != "CHARGE" and paid_count < true_up_min:
        return "CHARGE", f"{paid_count} paid invoices; TRUE_UP and DEFER need {true_up_min}"
    if requested == "DEFER" and paid_count < defer_min:
        return "TRUE_UP", f"DEFER needs {defer_min} paid invoices; client has {paid_count}"
    if requested == "DEFER" and balance_minor >= cap_minor:
        return "TRUE_UP", "FX balance is already at its cap"
    return requested, "allowed"


# --- settle triggers (pure) ---

def open_entries(entries: list) -> list:
    """FX entries posted since the last settlement, oldest first."""
    ordered = sorted(entries, key=lambda e: e.created_at)
    last = max((i for i, e in enumerate(ordered) if e.type == "SETTLEMENT"), default=-1)
    return [e for e in ordered[last + 1:] if e.type in ("TRUE_UP", "FX_DEFER", "CREDIT_APPLIED")]


def should_settle(balance_minor: int, cap_minor: int, settle_by_days: int, oldest_open_at: datetime | None, at: datetime, quarter_end: bool = False) -> str | None:
    """Credits never trigger: a negative balance is applied as a discount on the next invoice."""
    if balance_minor <= 0:
        return None
    if balance_minor >= cap_minor:
        return "CAP"
    if oldest_open_at and at - oldest_open_at >= timedelta(days=settle_by_days):
        return "AGE"
    return "QUARTER_END" if quarter_end else None


# --- DB operations ---

def client_entries(s: Session, client_id: str) -> list[LedgerEntry]:
    return list(s.exec(select(LedgerEntry).where(LedgerEntry.client_id == client_id)).all())


def new_client(s: Session, *, name: str, email: str, country: str, currency: str | None,
               demo_session_id: str | None = None) -> Client:
    base = get_settings(s).base_currency
    c = Client(name=name, email=email, country=country, currency=currency,
               cap_minor_base=to_minor(env.DEFAULT_CLIENT_CAP, base), settle_by_days=env.int("DEFAULT_SETTLE_BY_DAYS"),
               demo_session_id=demo_session_id)
    s.add(c)
    s.commit()
    s.refresh(c)
    return c


def refresh_proposals(s: Session, client_id: str, quarter_end: bool = False, at: datetime | None = None) -> Proposal | None:
    client = s.get(Client, client_id)
    entries = client_entries(s, client_id)
    base = get_settings(s).base_currency
    bal, opened = balance(entries), open_entries(entries)
    why = should_settle(bal, client.cap_minor_base, client.settle_by_days, opened[0].created_at if opened else None, at or now(), quarter_end)
    existing = s.exec(select(Proposal).where(Proposal.client_id == client_id, Proposal.kind == "SETTLE", Proposal.status == "OPEN")).first()
    if bal <= 0 or (not why and not existing):
        if existing:
            existing.status = "DISMISSED"
            s.add(existing)
            s.commit()
        return None
    p = existing or Proposal(client_id=client_id, kind="SETTLE", amount_minor=bal, reason="", demo_session_id=client.demo_session_id)
    p.amount_minor = bal
    if why:
        p.reason = {
            "CAP": f"FX balance {fmt(bal, base)} reached the {fmt(client.cap_minor_base, base)} cap.",
            "AGE": f"Oldest unsettled rate swing is over {client.settle_by_days} days old.",
            "QUARTER_END": "Quarter-end FX statement.",
        }[why]
    s.add(p)
    s.commit()
    s.refresh(p)
    return p


def approve_settle(s: Session, proposal_id: str) -> Invoice | None:
    """Positive balance → one grossed-up PayPal invoice, CHARGE so paying it creates no new true-up."""
    p = s.get(Proposal, proposal_id)
    if p is None or p.status != "OPEN":
        raise ValueError("Proposal is not open")
    client, st = s.get(Client, p.client_id), get_settings(s)
    base, out = st.base_currency, client.currency or st.base_currency
    bal = balance(client_entries(s, client.id))
    if bal <= 0:
        p.status = "DISMISSED"
        s.add(p)
        s.commit()
        return None
    q = quote(out, base)
    amounts = settlement_invoice(bal, base, out, invert(q.rate), st.fee_pct, st.spread_pct)
    inv = Invoice(
        client_id=client.id, description="FX statement settlement", source_minor=bal, source_currency=base,
        output_currency=out, base_currency=base, output_base_minor=amounts["output_base_minor"],
        fx_line_minor=amounts["gross_minor"] - amounts["output_base_minor"], treatment="CHARGE",
        ai_reason=p.reason, rate_invoiced=str(q.rate), rate_source=q.source, demo_session_id=client.demo_session_id,
    )
    draft = paypal.create_draft(paypal.invoice_payload(
        currency=out, email=client.email,
        note=f"Net FX rate movement on your invoices since the last statement: {fmt(bal, base)}. {p.client_note}".strip(),
        items=[("FX balance settlement", inv.output_base_minor), ("FX and processing", inv.fx_line_minor)],
    ))
    inv.paypal_invoice_id, inv.paypal_url, inv.status = draft["id"], paypal.send_and_get_link(draft["id"]), "SENT"
    p.status = "APPROVED"
    s.add_all([inv, p, *sent_entries(inv),
               LedgerEntry(client_id=client.id, invoice_id=inv.id, type="SETTLEMENT", amount_minor=-bal, note=f"Settled {fmt(bal, base)} on {draft['id']}",
                          demo_session_id=client.demo_session_id)])
    s.commit()
    s.refresh(inv)
    return inv


def on_invoice_paid(s: Session, paypal_invoice_id: str, at: datetime | None = None, paid_quote: Quote | None = None) -> Invoice | None:
    inv = s.exec(select(Invoice).where(Invoice.paypal_invoice_id == paypal_invoice_id)).first()
    if inv is None or inv.status == "PAID":
        return inv  # not a NetFirst invoice, or already handled
    q, at = paid_quote or payment_day(inv.output_currency, inv.base_currency), at or now()
    inv.status, inv.paid_at, inv.rate_paid, inv.rate_paid_source = "PAID", at, str(q.rate), q.source
    s.add_all([inv, *paid_entries(inv, q.rate, at)])
    s.commit()
    refresh_proposals(s, inv.client_id)
    return inv


def handle_event(s: Session, ev: dict) -> str:
    """Record the event only after processing, so a failed attempt is retried by PayPal rather than dropped."""
    if s.get(WebhookEvent, ev["id"]):
        return "duplicate"
    resource = ev.get("resource") or {}
    pid = (resource.get("invoice") or {}).get("id") or resource.get("id")
    result = "ignored"
    if ev.get("event_type") == "INVOICING.INVOICE.PAID" and pid:
        on_invoice_paid(s, pid)
        result = "paid"
    elif ev.get("event_type") == "INVOICING.INVOICE.CANCELLED" and pid:
        for inv in s.exec(select(Invoice).where(Invoice.paypal_invoice_id == pid)).all():
            inv.status = "CANCELLED"
            s.add(inv)
        result = "cancelled"
    s.add(WebhookEvent(id=ev["id"]))
    s.commit()
    return result
