"""SQLModel tables. Money is int minor units of the labelled currency; ledger amounts are base currency.
Rates are stored as strings to keep them exact. Balances are always derived from LedgerEntry."""
import uuid
from datetime import UTC, datetime

from sqlmodel import Field, Session, SQLModel, create_engine

from .config import env


def _id() -> str:
    return uuid.uuid4().hex


def now() -> datetime:
    return datetime.now(UTC)  # SQLModel stores and returns timezone-aware UTC


class Client(SQLModel, table=True):
    id: str = Field(default_factory=_id, primary_key=True)
    name: str
    email: str
    country: str
    currency: str | None = None  # preferred output currency
    cap_minor_base: int
    settle_by_days: int
    created_at: datetime = Field(default_factory=now)


class Invoice(SQLModel, table=True):
    id: str = Field(default_factory=_id, primary_key=True)
    client_id: str = Field(foreign_key="client.id", index=True)
    invoice_number: str | None = None
    description: str
    source_minor: int
    source_currency: str
    output_currency: str
    base_currency: str
    output_base_minor: int  # source converted to output, before FX line and discount
    fx_line_minor: int = 0
    discount_minor: int = 0
    defer_base_minor: int = 0  # DEFER: FX line posted to the balance, base currency
    treatment: str  # CHARGE, TRUE_UP, DEFER
    ai_reason: str
    rate_invoiced: str  # output -> base
    rate_source: str  # PAYPAL or ECB
    rate_paid: str | None = None
    rate_paid_source: str | None = None  # PAYPAL, ECB, DEMO_OVERRIDE
    status: str = "DRAFT"  # DRAFT, SENT, PAID, SETTLED, CANCELLED
    paypal_invoice_id: str | None = Field(default=None, unique=True)
    paypal_url: str | None = None
    source_file: str | None = None
    agent_run_id: str | None = None
    batch_id: str | None = None
    due_date: datetime | None = None
    paid_at: datetime | None = None
    created_at: datetime = Field(default_factory=now)


class LedgerEntry(SQLModel, table=True):
    id: str = Field(default_factory=_id, primary_key=True)
    client_id: str = Field(foreign_key="client.id", index=True)
    invoice_id: str | None = None
    type: str  # INVOICE, PAYMENT, TRUE_UP, FX_DEFER, SETTLEMENT, CREDIT_APPLIED
    amount_minor: int  # base currency; + client owes user, − user owes client
    note: str
    created_at: datetime = Field(default_factory=now)


class Proposal(SQLModel, table=True):
    id: str = Field(default_factory=_id, primary_key=True)
    client_id: str = Field(foreign_key="client.id", index=True)
    kind: str  # SETTLE or BATCH
    amount_minor: int
    invoice_ids: str = "[]"
    reason: str
    client_note: str = ""
    status: str = "OPEN"  # OPEN, APPROVED, DISMISSED
    created_at: datetime = Field(default_factory=now)


class Settings(SQLModel, table=True):
    id: int = Field(default=1, primary_key=True)
    base_currency: str
    fee_pct: str
    spread_pct: str


class AgentRun(SQLModel, table=True):
    id: str = Field(default_factory=_id, primary_key=True)
    file_name: str
    status: str  # RUNNING, NEEDS_INPUT, DRAFT_READY, SENT, FAILED
    extracted: str | None = None  # JSON
    steps: str = "[]"  # JSON trace for the UI
    question: str | None = None
    invoice_id: str | None = None
    created_at: datetime = Field(default_factory=now)


class WebhookEvent(SQLModel, table=True):
    id: str = Field(primary_key=True)  # PayPal event ID
    created_at: datetime = Field(default_factory=now)


class AiDecision(SQLModel, table=True):
    id: str = Field(default_factory=_id, primary_key=True)
    kind: str  # TREATMENT, SETTLEMENT, ASK
    input: str
    output: str
    model: str
    overridden: bool = False
    created_at: datetime = Field(default_factory=now)


# ponytail: create_all instead of migrations; delete the .db file after a schema change (no seed data to lose).
engine = create_engine(env.DATABASE_URL, connect_args={"check_same_thread": False})


def init_db() -> None:
    SQLModel.metadata.create_all(engine)


def get_settings(s: Session) -> Settings:
    row = s.get(Settings, 1)
    if row is None:
        row = Settings(base_currency=env.BASE_CURRENCY, fee_pct=env.FX_FEE_PCT, spread_pct=env.FX_SPREAD_PCT)
        s.add(row)
        s.commit()
        s.refresh(row)
    return row
