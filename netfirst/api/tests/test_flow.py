"""DB-backed: two real-shaped paid webhooks net against each other on one client's ledger."""
from sqlmodel import select

from app.fx import balance
from app.ledger import client_entries, handle_event, new_client, refresh_proposals
from app.models import Invoice, LedgerEntry
from app.rates import set_override


def sent_invoice(s, client, pid):
    inv = Invoice(client_id=client.id, description="Brand kit", source_minor=4400000, source_currency="INR", output_currency="GBP",
                  base_currency="INR", output_base_minor=34899, fx_line_minor=2931, treatment="TRUE_UP", ai_reason="test",
                  rate_invoiced="126.08", rate_source="ECB", status="SENT", paypal_invoice_id=pid)
    s.add(inv)
    s.commit()
    return inv


def paid_event(eid, pid):  # shape of PayPal's invoicing webhook; replace with a captured sandbox payload once it fires
    return {"id": eid, "event_type": "INVOICING.INVOICE.PAID", "resource": {"invoice": {"id": pid, "status": "PAID"}}}


def test_paid_webhooks_true_up_once_and_net(s):
    client = new_client(s, name="Northlane Agency", email="client@example.com", country="GB", currency="GBP")
    assert client.cap_minor_base == 500000  # DEFAULT_CLIENT_CAP=5000 INR from config
    loss, gain = sent_invoice(s, client, "INV2-A"), sent_invoice(s, client, "INV2-B")
    try:
        set_override("GBP", "123.50")
        assert handle_event(s, paid_event("WH-1", "INV2-A")) == "paid"
        assert handle_event(s, paid_event("WH-1", "INV2-A")) == "duplicate"
        set_override("GBP", "127.80")
        assert handle_event(s, paid_event("WH-2", "INV2-B")) == "paid"
    finally:
        set_override("GBP", None)

    def rows(inv):
        return [(e.type, e.amount_minor) for e in s.exec(select(LedgerEntry).where(LedgerEntry.invoice_id == inv.id).order_by(LedgerEntry.type)).all()]

    assert rows(loss) == [("PAYMENT", 4672005), ("TRUE_UP", 90039)]   # 37830×123.50; 34899×(126.08−123.50)
    assert rows(gain) == [("PAYMENT", 4834674), ("TRUE_UP", -60026)]  # 37830×127.80; 34899×(126.08−127.80)
    s.refresh(loss)
    assert (loss.status, loss.rate_paid_source) == ("PAID", "DEMO_OVERRIDE")

    assert balance(client_entries(s, client.id)) == 30013  # the gain nets most of the loss
    assert refresh_proposals(s, client.id) is None          # below cap
    p = refresh_proposals(s, client.id, quarter_end=True)
    assert (p.kind, p.amount_minor) == ("SETTLE", 30013)
