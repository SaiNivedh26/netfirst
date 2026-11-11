"""Drives the agent's tools directly (no LLM): guardrails, amounts from price_invoice only, trace hook."""
import json
import time
from decimal import Decimal

import pytest

from app import agent
from sqlmodel import select

from app.models import AgentRun, Invoice
from app.rates import Quote

RATES = {("INR", "GBP"): "0.007931", ("GBP", "INR"): "126.08", ("INR", "INR"): "1"}
GOOD = {"invoice_number": "PK-041", "client_name": "Northlane Agency", "client_email": "ap@northlane.example", "client_country": "GB",
        "currency": "INR", "items": [{"name": "Brand kit", "amount": "30,000.00"}, {"name": "Icons", "amount": "14000"}],
        "total": "44,000.00", "due_date": "2026-11-26"}


@pytest.fixture
def tools(s, monkeypatch):
    monkeypatch.setattr(agent, "quote", lambda f, t: Quote(Decimal(RATES[(f, t)]), "ECB", "2026-11-10"))
    sent = []
    monkeypatch.setattr(agent.paypal, "create_draft", lambda payload: sent.append(payload) or {"id": "INV2-DRAFT-1"})
    run = AgentRun(file_name="inv.pdf", status="RUNNING")
    s.add(run)
    s.commit()
    t = agent.InvoiceTools(run.id)
    t.sent = sent
    return t


def out(result):
    return json.loads(result)


def test_validation_catches_bad_sums_and_codes(tools):
    assert out(tools.validate_extraction(json.dumps(GOOD | {"total": "45000"})))["ok"] is False
    assert out(tools.validate_extraction(json.dumps(GOOD | {"currency": "RUPEES"})))["ok"] is False
    assert out(tools.validate_extraction("not json"))["ok"] is False
    assert out(tools.validate_extraction(json.dumps(GOOD)))["ok"] is True


def test_new_client_is_forced_to_charge_and_draft_uses_priced_amounts(tools, s):
    tools.validate_extraction(json.dumps(GOOD))
    assert out(tools.find_client("Northlane Agency", "ap@northlane.example"))["found"] is False
    assert out(tools.propose_client("Northlane Agency", "ap@northlane.example", "gb", "GBP"))["ok"] is True
    assert out(tools.find_client("Northlane Agncy"))["found"] is True  # fuzzy name match
    assert out(tools.get_client_history())["paid_invoices"] == 0

    tools.price_invoice("GBP", "TRUE_UP")
    assert out(tools.check_policy("TRUE_UP"))["allowed"] == "CHARGE"
    assert out(tools.create_paypal_draft("Repeat client"))["ok"] is False  # guardrail re-checked at draft time
    assert tools.sent == []

    priced = out(tools.price_invoice("GBP", "CHARGE"))
    assert priced["total"] == "£378.26"  # 44,000 × 0.007931 = £348.96, grossed up by 0.92254
    assert out(tools.create_paypal_draft("New client, so FX costs are charged up front."))["ok"] is True

    inv = s.exec(select(Invoice)).one()
    assert (inv.output_base_minor, inv.fx_line_minor, inv.paypal_invoice_id, inv.treatment) == (34896, 2930, "INV2-DRAFT-1", "CHARGE")
    assert [i["unit_amount"]["value"] for i in tools.sent[0]["items"]] == ["348.96", "29.30"]
    assert tools.sent[0]["detail"]["payment_term"] == {"term_type": "DUE_ON_DATE_SPECIFIED", "due_date": "2026-11-26"}
    s.refresh(run := s.get(AgentRun, tools.run_id))
    assert run.status == "DRAFT_READY" and run.invoice_id == inv.id


def test_ask_user_pauses_the_run(tools, s):
    tools.ask_user("Is $ USD or AUD?")
    run = s.get(AgentRun, tools.run_id)
    s.refresh(run)
    assert (run.status, run.question) == ("NEEDS_INPUT", "Is $ USD or AUD?")


def test_trace_hook_records_each_step(tools, s):
    hook = agent._trace(tools.run_id, time.monotonic())
    hook(function_name="get_fx_quote", function_call=tools.get_fx_quote, arguments={"from_currency": "GBP", "to_currency": "INR"})
    run = s.get(AgentRun, tools.run_id)
    s.refresh(run)
    assert [(st["tool"], st["summary"]) for st in json.loads(run.steps)] == [("get_fx_quote", "1 GBP = 126.08 INR (ECB, 2026-11-10)")]


def test_timeout_fails_the_run_and_blocks_the_draft(tools, s):
    hook = agent._trace(tools.run_id, time.monotonic() - 10_000)
    out = json.loads(hook(function_name="get_fx_quote", function_call=tools.get_fx_quote, arguments={"from_currency": "GBP", "to_currency": "INR"}))
    assert out["ok"] is False
    run = s.get(AgentRun, tools.run_id)
    s.refresh(run)
    assert run.status == "FAILED"
    tools.validate_extraction(json.dumps(GOOD))
    tools.propose_client("Northlane Agency", "ap@northlane.example", "GB", "GBP")
    tools.price_invoice("GBP", "CHARGE")
    assert json.loads(tools.create_paypal_draft("x"))["ok"] is False and tools.sent == []
