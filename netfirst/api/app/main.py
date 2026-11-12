"""NetFirst API. Run from netfirst/api:  uv run uvicorn app.main:app --reload"""
import json
import secrets
from datetime import UTC, datetime
from typing import Literal

from fastapi import Cookie, Depends, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from pydantic import BaseModel
from sqlmodel import Session, select

from . import agent, paypal
from .config import env
from .fx import balance, convert, fmt, is_currency
from .ledger import approve_settle, client_entries, handle_event, new_client, on_invoice_paid, refresh_proposals
from .models import AgentRun, Client, DemoSession, Invoice, LedgerEntry, Proposal, engine, get_settings, init_db
from .rates import get_overrides, set_override

app = FastAPI(title="NetFirst")
_origins = ["http://localhost:3000", "http://127.0.0.1:3000"]
try:
    _origins = env.list("WEB_ORIGIN")
except RuntimeError:
    pass
app.add_middleware(CORSMiddleware, allow_origins=_origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
init_db()

_static = Path(__file__).parent.parent / "static"
if _static.exists():
    app.mount("/static", StaticFiles(directory=str(_static)), name="static")

@app.get("/", include_in_schema=False)
def index():
    return FileResponse(str(_static / "index.html"))


def db():
    with Session(engine) as s:
        yield s


def get_demo_session(nf_session: str | None = Cookie(default=None)) -> str | None:
    """In DEMO_MODE return the session ID from cookie; outside DEMO_MODE return None (no filtering)."""
    if env.DEMO_MODE != "1":
        return None
    return nf_session


def scoped(stmt, model, session_id: str | None):
    """Add a demo_session_id filter when session_id is not None."""
    return stmt.where(model.demo_session_id == session_id) if session_id else stmt


def money(minor: int, currency: str) -> dict:
    return {"minor": minor, "currency": currency, "display": fmt(minor, currency)}


def fail(e: Exception, code: int = 400):
    raise HTTPException(code, str(e)) from e


# --- agent runs ---

@app.post("/api/agent/runs")
async def start_run(file: UploadFile = File(...), output_currency: str | None = Form(None),
                    session_id: str | None = Depends(get_demo_session)):
    if output_currency and not is_currency(output_currency):
        raise HTTPException(400, f"{output_currency} is not an ISO 4217 code")
    return {"id": agent.start(file.filename or "invoice.pdf", await file.read(), output_currency, session_id)}


@app.get("/api/agent/runs")
def list_runs(s: Session = Depends(db), session_id: str | None = Depends(get_demo_session)):
    stmt = scoped(select(AgentRun).order_by(AgentRun.created_at.desc()).limit(50), AgentRun, session_id)
    return [r.model_dump() for r in s.exec(stmt).all()]


@app.get("/api/agent/runs/{run_id}")
def get_run(run_id: str, s: Session = Depends(db)):
    run = s.get(AgentRun, run_id) or fail(KeyError("run not found"), 404)
    inv = s.get(Invoice, run.invoice_id) if run.invoice_id else None
    draft = None
    if inv:
        out = inv.output_currency
        draft = {"invoice_id": inv.id, "paypal_invoice_id": inv.paypal_invoice_id, "paypal_url": inv.paypal_url, "status": inv.status,
                 "currency": out, "work": money(inv.output_base_minor, out), "fx_line": money(inv.fx_line_minor, out),
                 "discount": money(inv.discount_minor, out), "total": money(inv.output_base_minor - inv.discount_minor + inv.fx_line_minor, out),
                 "deferred": money(inv.defer_base_minor, inv.base_currency), "treatment": inv.treatment, "reason": inv.ai_reason,
                 "rate": inv.rate_invoiced, "rate_source": inv.rate_source}
    return {"id": run.id, "file_name": run.file_name, "status": run.status, "question": run.question,
            "extracted": json.loads(run.extracted) if run.extracted else None, "steps": json.loads(run.steps), "draft": draft}


class Answer(BaseModel):
    answer: str
    output_currency: str | None = None


@app.post("/api/agent/runs/{run_id}/answer")
def answer_run(run_id: str, body: Answer):
    try:
        agent.resume(run_id, body.answer, body.output_currency)
    except ValueError as e:
        fail(e)
    return {"ok": True}


class Reprice(BaseModel):
    output_currency: str | None = None
    treatment: Literal["CHARGE", "TRUE_UP", "DEFER"] | None = None


@app.post("/api/agent/runs/{run_id}/reprice")
def reprice_run(run_id: str, body: Reprice):
    try:
        agent.reprice(run_id, body.output_currency, body.treatment)
    except (ValueError, paypal.PayPalError) as e:
        fail(e)
    return {"ok": True}


@app.post("/api/agent/runs/{run_id}/approve")
def approve_run(run_id: str):
    try:
        inv = agent.approve(run_id)
    except (ValueError, paypal.PayPalError) as e:
        fail(e)
    return {"ok": True, "paypal_url": inv.paypal_url}


# --- ledger views ---

@app.get("/api/clients")
def list_clients(s: Session = Depends(db), session_id: str | None = Depends(get_demo_session)):
    base = get_settings(s).base_currency
    rows = []
    for c in s.exec(scoped(select(Client), Client, session_id)).all():
        entries = client_entries(s, c.id)
        invoices = s.exec(select(Invoice).where(Invoice.client_id == c.id)).all()
        bal = balance(entries)
        swings = sorted((e for e in entries if e.type == "TRUE_UP"), key=lambda e: e.created_at)
        fx_charged = sum(convert(i.fx_line_minor, i.output_currency, base, i.rate_invoiced) + i.defer_base_minor for i in invoices if i.status != "DRAFT")
        open_p = s.exec(select(Proposal).where(Proposal.client_id == c.id, Proposal.status == "OPEN")).first()
        rows.append({
            "id": c.id, "name": c.name, "email": c.email, "country": c.country, "currency": c.currency,
            "invoiced": money(sum(e.amount_minor for e in entries if e.type == "INVOICE"), base),
            "fx_charged": money(fx_charged, base), "fx_balance": money(bal, base), "cap": money(c.cap_minor_base, base),
            "last_swing": money(swings[-1].amount_minor, base) if swings else None,
            "treatments": {t: sum(i.treatment == t for i in invoices) for t in ("CHARGE", "TRUE_UP", "DEFER")},
            "next_action": "SETTLE" if open_p else ("CREDIT_ON_NEXT_INVOICE" if bal < 0 else None),
        })
    return rows


class NewClient(BaseModel):
    name: str
    email: str
    country: str
    currency: str | None = None


@app.post("/api/clients")
def add_client(body: NewClient, s: Session = Depends(db), session_id: str | None = Depends(get_demo_session)):
    if body.currency and not is_currency(body.currency):
        raise HTTPException(400, f"{body.currency} is not an ISO 4217 code")
    return new_client(s, demo_session_id=session_id, **body.model_dump())


@app.get("/api/clients/{client_id}/invoices")
def client_invoices(client_id: str, s: Session = Depends(db)):
    rows = []
    for i in s.exec(select(Invoice).where(Invoice.client_id == client_id).order_by(Invoice.created_at.desc())).all():
        swing = s.exec(select(LedgerEntry).where(LedgerEntry.invoice_id == i.id, LedgerEntry.type == "TRUE_UP")).first()
        rows.append(i.model_dump() | {
            "source": money(i.source_minor, i.source_currency), "total": money(i.output_base_minor - i.discount_minor + i.fx_line_minor, i.output_currency),
            "fx_line": money(i.fx_line_minor, i.output_currency), "true_up": money(swing.amount_minor, i.base_currency) if swing else None,
            "demo_rate": i.rate_paid_source == "DEMO_OVERRIDE",
        })
    return rows


@app.get("/api/invoices")
def list_invoices(s: Session = Depends(db), session_id: str | None = Depends(get_demo_session)):
    rows = []
    for i in s.exec(scoped(select(Invoice).order_by(Invoice.created_at.desc()), Invoice, session_id)).all():
        swing = s.exec(select(LedgerEntry).where(LedgerEntry.invoice_id == i.id, LedgerEntry.type == "TRUE_UP")).first()
        rows.append(i.model_dump() | {
            "source": money(i.source_minor, i.source_currency), "total": money(i.output_base_minor - i.discount_minor + i.fx_line_minor, i.output_currency),
            "fx_line": money(i.fx_line_minor, i.output_currency), "true_up": money(swing.amount_minor, i.base_currency) if swing else None,
            "demo_rate": i.rate_paid_source == "DEMO_OVERRIDE",
        })
    return rows


@app.get("/api/ledger")
def list_ledger(s: Session = Depends(db), session_id: str | None = Depends(get_demo_session)):
    base = get_settings(s).base_currency
    names = {c.id: c.name for c in s.exec(scoped(select(Client), Client, session_id)).all()}
    invs = {i.id: i for i in s.exec(scoped(select(Invoice), Invoice, session_id)).all()}
    stmt = scoped(select(LedgerEntry).order_by(LedgerEntry.created_at.desc()), LedgerEntry, session_id)
    return [{
        "id": e.id, "client_id": e.client_id, "invoice_id": e.invoice_id, "client": names.get(e.client_id), "type": e.type, "note": e.note,
        "created_at": e.created_at, "amount": money(e.amount_minor, base),
        "invoice_number": invs[e.invoice_id].invoice_number if e.invoice_id in invs else None,
        "treatment": invs[e.invoice_id].treatment if e.invoice_id in invs else None,
    } for e in s.exec(stmt).all()]


@app.get("/api/summary")
def summary(s: Session = Depends(db), session_id: str | None = Depends(get_demo_session)):
    base = get_settings(s).base_currency
    today = datetime.now(UTC)
    quarter_start = today.replace(month=(today.month - 1) // 3 * 3 + 1, day=1, hour=0, minute=0, second=0, microsecond=0)
    entries = s.exec(scoped(select(LedgerEntry), LedgerEntry, session_id)).all()
    open_proposals_stmt = scoped(select(Proposal).where(Proposal.status == "OPEN"), Proposal, session_id)
    return {
        "invoiced_this_quarter": money(sum(e.amount_minor for e in entries if e.type == "INVOICE" and e.created_at >= quarter_start), base),
        "net_fx_balance": money(balance(entries), base),
        "true_ups_netted": money(sum(abs(e.amount_minor) for e in entries if e.type == "TRUE_UP") - abs(sum(e.amount_minor for e in entries if e.type == "TRUE_UP")), base),
        "open_proposals": len(s.exec(open_proposals_stmt).all()),
    }


# --- proposals ---

@app.get("/api/proposals")
def list_proposals(s: Session = Depends(db), session_id: str | None = Depends(get_demo_session)):
    base = get_settings(s).base_currency
    stmt = scoped(select(Proposal).where(Proposal.status == "OPEN"), Proposal, session_id)
    return [p.model_dump() | {"amount": money(p.amount_minor, base), "client": s.get(Client, p.client_id).name}
            for p in s.exec(stmt).all()]


@app.post("/api/proposals/{proposal_id}/approve")
def approve_proposal(proposal_id: str, s: Session = Depends(db)):
    try:
        inv = approve_settle(s, proposal_id)
    except (ValueError, paypal.PayPalError) as e:
        fail(e)
    return {"ok": True, "paypal_url": inv.paypal_url if inv else None, "invoice_id": inv.id if inv else None}


@app.post("/api/proposals/{proposal_id}/dismiss")
def dismiss_proposal(proposal_id: str, s: Session = Depends(db)):
    p = s.get(Proposal, proposal_id) or fail(KeyError("proposal not found"), 404)
    p.status = "DISMISSED"
    s.add(p)
    s.commit()
    return {"ok": True}


# --- PayPal ---

@app.post("/api/webhooks/paypal")
async def paypal_webhook(request: Request, s: Session = Depends(db)):
    event = await request.json()
    if not paypal.verify_signature(dict(request.headers), event):
        raise HTTPException(400, "invalid signature")
    return {"result": handle_event(s, event)}


@app.post("/api/invoices/{invoice_id}/sync")
def sync_invoice(invoice_id: str, s: Session = Depends(db)):
    """Fallback when webhooks are slow: read the status from PayPal and run the paid handler."""
    inv = s.get(Invoice, invoice_id) or fail(KeyError("invoice not found"), 404)
    status = paypal.call("GET", f"/v2/invoicing/invoices/{inv.paypal_invoice_id}").get("status")
    if status in ("PAID", "MARKED_AS_PAID"):
        on_invoice_paid(s, inv.paypal_invoice_id)
    return {"paypal_status": status}


# --- settings ---

class SettingsIn(BaseModel):
    base_currency: str | None = None
    fee_pct: str | None = None
    spread_pct: str | None = None


@app.get("/api/settings")
def read_settings(s: Session = Depends(db)):
    return get_settings(s)


@app.put("/api/settings")
def write_settings(body: SettingsIn, s: Session = Depends(db)):
    st = get_settings(s)
    if body.base_currency and not is_currency(body.base_currency):
        raise HTTPException(400, f"{body.base_currency} is not an ISO 4217 code")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(st, k, v)
    s.add(st)
    s.commit()
    s.refresh(st)
    return st


# --- demo controls (DEMO_MODE=1 only; every use is labelled DEMO_OVERRIDE in the ledger) ---

def demo_only():
    if env.DEMO_MODE != "1":
        raise HTTPException(404)


@app.post("/api/demo/session")
def create_session(response: Response):
    """Create a new isolated demo session. Sets nf_session cookie."""
    from .scripts import seed  # import inline to avoid circular
    sid = secrets.token_urlsafe(9)[:12]  # 12-char slug
    with Session(engine) as s:
        s.add(DemoSession(id=sid))
        s.commit()
    seed.seed_session(sid)
    response.set_cookie("nf_session", sid, max_age=86400 * 7, samesite="lax")
    return {"session_id": sid}


@app.post("/api/demo/reset", dependencies=[Depends(demo_only)])
def reset_session(session_id: str | None = Depends(get_demo_session), s: Session = Depends(db)):
    """Wipe this session's data and re-seed."""
    if not session_id:
        raise HTTPException(400, "No active session")
    from . import scripts  # noqa: F401
    from .scripts import seed as seed_mod
    # delete all rows for this session
    for model in [LedgerEntry, Proposal, Invoice, AgentRun, Client]:
        rows = s.exec(select(model).where(model.demo_session_id == session_id)).all()
        for r in rows:
            s.delete(r)
    s.commit()
    seed_mod.seed_session(session_id)
    return {"reset": True}


@app.post("/api/demo/scenario/{slug}/reset", dependencies=[Depends(demo_only)])
def reset_scenario(slug: str, session_id: str | None = Depends(get_demo_session)):
    from .scripts import seed as seed_mod
    if not session_id:
        raise HTTPException(400, "No active session")
    if slug not in seed_mod.SCENARIOS:
        raise HTTPException(404, "Unknown scenario")
    seed_mod.reset_scenario(session_id, slug)
    return {"reset": slug}


@app.post("/api/demo/simulate-payment/{invoice_id}", dependencies=[Depends(demo_only)])
def simulate_payment(invoice_id: str, s: Session = Depends(db)):
    """Mark an invoice as paid and run the full ledger true-up (same path as real webhook)."""
    inv = s.get(Invoice, invoice_id)
    if not inv:
        raise HTTPException(404, "Invoice not found")
    if inv.status != "SENT":
        raise HTTPException(400, f"Invoice status is {inv.status}, expected SENT")
    try:
        on_invoice_paid(s, inv.paypal_invoice_id or invoice_id, datetime.now(UTC))
    except Exception as e:
        raise HTTPException(500, str(e)) from e
    s.refresh(inv)
    return {"status": inv.status, "paid_at": inv.paid_at}


@app.get("/api/sample-invoices")
def list_sample_invoices():
    """Return the list of pre-built scenario PDFs for the demo scenario picker."""
    samples_dir = Path(__file__).parent.parent / "sample_invoices"
    if not samples_dir.exists():
        return []
    result = []
    # Read a companion JSON manifest if it exists, else just list files
    manifest_path = samples_dir / "manifest.json"
    if manifest_path.exists():
        import json as _json
        result = _json.loads(manifest_path.read_text())
    else:
        for f in sorted(samples_dir.glob("*.pdf")):
            result.append({"id": f.stem, "label": f.stem.replace("-", " ").title(), "filename": f.name})
    return result


@app.get("/api/sample-invoices/{sample_id}/file")
def get_sample_invoice(sample_id: str):
    samples_dir = Path(__file__).parent.parent / "sample_invoices"
    path = samples_dir / f"{sample_id}.pdf"
    if not path.exists():
        raise HTTPException(404, "Sample not found")
    return FileResponse(str(path), media_type="application/pdf", filename=path.name, content_disposition_type="inline")


class Override(BaseModel):
    currency: str
    rate: str | None


@app.get("/api/demo/rate-override", dependencies=[Depends(demo_only)])
def read_overrides():
    return get_overrides()


@app.put("/api/demo/rate-override", dependencies=[Depends(demo_only)])
def write_override(body: Override):
    try:
        set_override(body.currency, body.rate)
    except ArithmeticError as e:
        fail(e)
    return get_overrides()


@app.post("/api/demo/quarter-end", dependencies=[Depends(demo_only)])
def quarter_end(s: Session = Depends(db)):
    return [p for c in s.exec(select(Client)).all() if (p := refresh_proposals(s, c.id, quarter_end=True))]


# --- webhook registration helper (always available, not demo-only) ---

class WebhookUrlBody(BaseModel):
    url: str


@app.post("/api/demo/webhook-url")
def set_webhook_url(body: WebhookUrlBody):
    """PATCH the registered PayPal webhook to point to a new URL (e.g. a fresh ngrok tunnel)."""
    webhook_id = env.PAYPAL_WEBHOOK_ID
    try:
        result = paypal.call(
            "PATCH",
            f"/v1/notifications/webhooks/{webhook_id}",
            [{"op": "replace", "path": "/url", "value": body.url}],
        )
    except paypal.PayPalError as e:
        raise HTTPException(e.status, detail=e.body)
    return {"webhook_id": webhook_id, "url": body.url, "result": result}
