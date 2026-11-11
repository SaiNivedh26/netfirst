"""NetFirst API. Run from netfirst/api:  uv run uvicorn app.main:app --reload"""
import json
from datetime import UTC, datetime
from typing import Literal

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
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
from .models import AgentRun, Client, Invoice, LedgerEntry, Proposal, engine, get_settings, init_db
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


def money(minor: int, currency: str) -> dict:
    return {"minor": minor, "currency": currency, "display": fmt(minor, currency)}


def fail(e: Exception, code: int = 400):
    raise HTTPException(code, str(e)) from e


# --- agent runs ---

@app.post("/api/agent/runs")
async def start_run(file: UploadFile = File(...), output_currency: str | None = Form(None)):
    if output_currency and not is_currency(output_currency):
        raise HTTPException(400, f"{output_currency} is not an ISO 4217 code")
    return {"id": agent.start(file.filename or "invoice.pdf", await file.read(), output_currency)}


@app.get("/api/agent/runs")
def list_runs(s: Session = Depends(db)):
    return [r.model_dump() for r in s.exec(select(AgentRun).order_by(AgentRun.created_at.desc()).limit(50)).all()]


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
def list_clients(s: Session = Depends(db)):
    base = get_settings(s).base_currency
    rows = []
    for c in s.exec(select(Client)).all():
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
def add_client(body: NewClient, s: Session = Depends(db)):
    if body.currency and not is_currency(body.currency):
        raise HTTPException(400, f"{body.currency} is not an ISO 4217 code")
    return new_client(s, **body.model_dump())


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
def list_invoices(s: Session = Depends(db)):
    rows = []
    for i in s.exec(select(Invoice).order_by(Invoice.created_at.desc())).all():
        swing = s.exec(select(LedgerEntry).where(LedgerEntry.invoice_id == i.id, LedgerEntry.type == "TRUE_UP")).first()
        rows.append(i.model_dump() | {
            "source": money(i.source_minor, i.source_currency), "total": money(i.output_base_minor - i.discount_minor + i.fx_line_minor, i.output_currency),
            "fx_line": money(i.fx_line_minor, i.output_currency), "true_up": money(swing.amount_minor, i.base_currency) if swing else None,
            "demo_rate": i.rate_paid_source == "DEMO_OVERRIDE",
        })
    return rows


@app.get("/api/summary")
def summary(s: Session = Depends(db)):
    base = get_settings(s).base_currency
    today = datetime.now(UTC)
    quarter_start = today.replace(month=(today.month - 1) // 3 * 3 + 1, day=1, hour=0, minute=0, second=0, microsecond=0)
    entries = s.exec(select(LedgerEntry)).all()
    return {
        "invoiced_this_quarter": money(sum(e.amount_minor for e in entries if e.type == "INVOICE" and e.created_at >= quarter_start), base),
        "net_fx_balance": money(balance(entries), base),
        "true_ups_netted": money(sum(abs(e.amount_minor) for e in entries if e.type == "TRUE_UP") - abs(sum(e.amount_minor for e in entries if e.type == "TRUE_UP")), base),
        "open_proposals": len(s.exec(select(Proposal).where(Proposal.status == "OPEN")).all()),
    }


# --- proposals ---

@app.get("/api/proposals")
def list_proposals(s: Session = Depends(db)):
    base = get_settings(s).base_currency
    return [p.model_dump() | {"amount": money(p.amount_minor, base), "client": s.get(Client, p.client_id).name}
            for p in s.exec(select(Proposal).where(Proposal.status == "OPEN")).all()]


@app.post("/api/proposals/{proposal_id}/approve")
def approve_proposal(proposal_id: str, s: Session = Depends(db)):
    try:
        inv = approve_settle(s, proposal_id)
    except (ValueError, paypal.PayPalError) as e:
        fail(e)
    return {"ok": True, "paypal_url": inv.paypal_url if inv else None}


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
