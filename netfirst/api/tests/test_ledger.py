from datetime import datetime
from types import SimpleNamespace as E

from app.ledger import allowed_treatment, open_entries, paid_entries, sent_entries, should_settle
from app.models import Invoice

INV = dict(id="i1", client_id="c1", description="x", source_minor=0, source_currency="INR", treatment="TRUE_UP",
           output_currency="GBP", base_currency="INR", output_base_minor=40000, discount_minor=0, fx_line_minor=3359,
           defer_base_minor=0, rate_invoiced="110", rate_source="ECB", ai_reason="")


def rows(entries):
    return [(e.type, e.amount_minor) for e in entries]


def test_sent_entries():
    assert rows(sent_entries(Invoice(**INV))) == [("INVOICE", 4769490)]
    assert rows(sent_entries(Invoice(**INV | dict(treatment="DEFER", fx_line_minor=0, defer_base_minor=369490)))) == [("INVOICE", 4400000), ("FX_DEFER", 369490)]
    assert rows(sent_entries(Invoice(**INV | dict(discount_minor=727)))) == [("INVOICE", 4689520), ("CREDIT_APPLIED", 79970)]


def test_paid_entries():
    assert rows(paid_entries(Invoice(**INV | dict(treatment="CHARGE")), "107")) == [("PAYMENT", 4639413)]
    assert rows(paid_entries(Invoice(**INV), "107")) == [("PAYMENT", 4639413), ("TRUE_UP", 120000)]
    assert rows(paid_entries(Invoice(**INV), "112")) == [("PAYMENT", 4856208), ("TRUE_UP", -80000)]


def test_guardrails_from_config():  # .env.example: TRUE_UP needs 2 paid, DEFER needs 3
    assert allowed_treatment("TRUE_UP", 1, 0, 500000)[0] == "CHARGE"
    assert allowed_treatment("DEFER", 2, 0, 500000)[0] == "TRUE_UP"
    assert allowed_treatment("DEFER", 3, 500000, 500000)[0] == "TRUE_UP"
    assert allowed_treatment("DEFER", 3, 0, 500000) == ("DEFER", "allowed")


def test_settle_triggers():
    at = datetime(2026, 11, 11)
    assert should_settle(500000, 500000, 90, None, at) == "CAP"
    assert should_settle(1000, 500000, 90, datetime(2026, 8, 1), at) == "AGE"
    assert should_settle(1000, 500000, 90, datetime(2026, 10, 1), at) is None
    assert should_settle(1000, 500000, 90, None, at, quarter_end=True) == "QUARTER_END"
    assert should_settle(-900000, 500000, 90, None, at, quarter_end=True) is None


def test_open_entries_restart_after_settlement():
    d = lambda m: datetime(2026, m, 1)  # noqa: E731
    entries = [E(type="TRUE_UP", amount_minor=5, created_at=d(8)), E(type="SETTLEMENT", amount_minor=-5, created_at=d(9)),
               E(type="PAYMENT", amount_minor=9, created_at=d(10)), E(type="TRUE_UP", amount_minor=7, created_at=d(11))]
    assert [e.amount_minor for e in open_entries(entries)] == [7]
