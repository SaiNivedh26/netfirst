"""Seed one client per FX treatment, with history posted through the real ledger rules.

Run standalone:  uv run python -m app.scripts.seed [session_id]
Called from API: from app.scripts import seed; seed.seed_session(session_id)
"""
import sys
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from sqlmodel import Session, select

from app.config import env
from app.fx import convert, to_minor
from app.ledger import paid_entries, refresh_proposals, sent_entries
from app.models import Client, Invoice, LedgerEntry, Proposal, engine, init_db
from app.rates import quote

FX_PCT = {"CHARGE": Decimal("0.035"), "TRUE_UP": Decimal("0.015"), "DEFER": Decimal("0.015")}


def _ago(days: float) -> datetime:
    return datetime.now(UTC) - timedelta(days=days)


def _client(s, sid, name, email, country, currency, cap_major):
    c = Client(name=name, email=email, country=country, currency=currency,
               cap_minor_base=to_minor(str(cap_major), env.BASE_CURRENCY), settle_by_days=90, demo_session_id=sid)
    s.add(c)
    s.commit()
    s.refresh(c)
    return c


def _invoice(s, sid, c, number, desc, major, ccy, treatment, base_rate, drift_sent, drift_paid, days_ago, paid=True):
    """drift_* shift the live rate so the paid rate differs from the invoiced one and a real swing posts."""
    base = env.BASE_CURRENCY
    r_sent = (base_rate * (1 + Decimal(drift_sent))).quantize(Decimal("0.000001"))
    r_paid = (base_rate * (1 + Decimal(drift_paid))).quantize(Decimal("0.000001"))
    work = to_minor(str(major), ccy)
    fx = int(work * FX_PCT[treatment])
    inv = Invoice(
        client_id=c.id, demo_session_id=sid, invoice_number=number, description=desc,
        source_minor=work, source_currency=ccy, output_currency=ccy, base_currency=base,
        output_base_minor=work,
        fx_line_minor=0 if treatment == "DEFER" else fx,
        defer_base_minor=convert(fx, ccy, base, r_sent) if treatment == "DEFER" else 0,
        treatment=treatment, ai_reason=REASONS[treatment],
        rate_invoiced=str(r_sent), rate_source="PAYPAL",
        status="SENT", created_at=_ago(days_ago), due_date=_ago(days_ago - 30),
    )
    s.add(inv)
    s.commit()
    s.refresh(inv)
    rows = sent_entries(inv, at=inv.created_at)
    if paid:
        inv.status, inv.rate_paid, inv.rate_paid_source, inv.paid_at = "PAID", str(r_paid), "PAYPAL", _ago(days_ago - 12)
        rows += paid_entries(inv, r_paid, at=inv.paid_at)
    for e in rows:
        e.demo_session_id = sid
        s.add(e)
    s.add(inv)
    s.commit()
    return inv


REASONS = {
    "CHARGE": "New client with no payment history: FX cost is charged upfront on the invoice.",
    "TRUE_UP": "Reliable payer: rate movement between send and payment is tracked and netted on the FX statement.",
    "DEFER": "Trusted client under cap: FX cost is carried to the running balance instead of the invoice.",
}


def _rate(ccy: str):
    return quote(ccy, env.BASE_CURRENCY).rate


def _charge(s, sid):
    gbp = _rate("GBP")
    ms = _client(s, sid, "Marks & Spencer", "accounts@marks-spencer.example.com", "GB", "GBP", 250000)
    _invoice(s, sid, ms, "MS-1001", "Retail analytics pilot", 18500, "GBP", "CHARGE", gbp, 0, "0.012", 21)


def _true_up(s, sid):
    gbp = _rate("GBP")
    ag = _client(s, sid, "Apple Green Ltd", "apple-green@example.com", "GB", "GBP", 250000)
    _invoice(s, sid, ag, "AG-2001", "Brand strategy workshop", 22000, "GBP", "CHARGE", gbp, "-0.010", 0, 95)
    _invoice(s, sid, ag, "AG-2002", "Campaign design retainer", 34500, "GBP", "TRUE_UP", gbp, "-0.002", "0.002", 64)
    _invoice(s, sid, ag, "AG-2003", "Campaign design retainer", 34500, "GBP", "TRUE_UP", gbp, "0.008", "-0.004", 33, paid=False)
    _invoice(s, sid, ag, "AG-2004", "Q3 media buying support", 28750, "GBP", "TRUE_UP", gbp, 0, 0, 6, paid=False)


def _defer(s, sid):
    eur = _rate("EUR")
    et = _client(s, sid, "Eurotech GmbH", "invoices@eurotech-example.com", "DE", "EUR", 900000)
    _invoice(s, sid, et, "ET-3001", "Platform integration phase 1", 42000, "EUR", "CHARGE", eur, "-0.004", 0, 150)
    _invoice(s, sid, et, "ET-3002", "Platform integration phase 2", 46000, "EUR", "TRUE_UP", eur, "0.003", "0.010", 118)
    _invoice(s, sid, et, "ET-3003", "Platform integration phase 3", 46000, "EUR", "TRUE_UP", eur, "0.006", "-0.002", 86)
    _invoice(s, sid, et, "ET-3004", "Managed services, July", 38500, "EUR", "DEFER", eur, "-0.002", "0.004", 52)
    _invoice(s, sid, et, "ET-3005", "Managed services, August", 38500, "EUR", "DEFER", eur, "0.001", "0.007", 22)


def _settle(s, sid):
    usd = _rate("USD")
    gf = _client(s, sid, "Global Freight Co", "billing@global-freight-example.com", "US", "USD", 120000)
    _invoice(s, sid, gf, "GF-4001", "Logistics dashboard build", 52000, "USD", "CHARGE", usd, "0.005", 0, 160)
    _invoice(s, sid, gf, "GF-4002", "Route optimisation module", 61000, "USD", "TRUE_UP", usd, "0.006", "-0.005", 128)
    _invoice(s, sid, gf, "GF-4003", "Route optimisation module", 61000, "USD", "TRUE_UP", usd, "0.009", "-0.002", 97)
    _invoice(s, sid, gf, "GF-4004", "Fleet telemetry, Q2", 74000, "USD", "DEFER", usd, "0.008", "-0.004", 66)
    _invoice(s, sid, gf, "GF-4005", "Fleet telemetry, Q3", 74000, "USD", "DEFER", usd, "0.010", "0.001", 35)
    refresh_proposals(s, gf.id)


# scenario slug -> (client name, seeder)
SCENARIOS = {
    "charge": ("Marks & Spencer", _charge),
    "true-up": ("Apple Green Ltd", _true_up),
    "defer": ("Eurotech GmbH", _defer),
    "settle": ("Global Freight Co", _settle),
}


def seed_session(session_id: str) -> None:
    with Session(engine) as s:
        for _, seeder in SCENARIOS.values():
            seeder(s, session_id)


def reset_scenario(session_id: str, slug: str) -> None:
    """Put one scenario's client back to its seeded history so the guided run lands the same way every time."""
    name, seeder = SCENARIOS[slug]
    with Session(engine) as s:
        for c in s.exec(select(Client).where(Client.demo_session_id == session_id, Client.name == name)).all():
            for model in (LedgerEntry, Proposal, Invoice):
                for row in s.exec(select(model).where(model.client_id == c.id)).all():
                    s.delete(row)
            s.delete(c)
        s.commit()
        seeder(s, session_id)


if __name__ == "__main__":
    init_db()
    sid = sys.argv[1] if len(sys.argv) > 1 else "demo-seed-01"
    seed_session(sid)
    print(f"Seeded session {sid}")
