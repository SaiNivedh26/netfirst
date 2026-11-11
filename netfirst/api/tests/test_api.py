"""Routes over the real app with the ASGI test client (no PayPal, no LLM)."""
from fastapi.testclient import TestClient

from app.main import app

api = TestClient(app)


def test_clients_settings_and_demo_controls(s):
    assert api.post("/api/clients", json={"name": "Kofu Labs", "email": "b@kofu.example", "country": "DE", "currency": "EURO"}).status_code == 400
    c = api.post("/api/clients", json={"name": "Kofu Labs", "email": "b@kofu.example", "country": "DE", "currency": "EUR"}).json()
    row = api.get("/api/clients").json()[0]
    assert (row["id"], row["fx_balance"]["display"], row["cap"]["display"]) == (c["id"], "₹0.00", "₹5,000.00")
    assert api.get("/api/settings").json()["fee_pct"] == "0.044"
    assert api.put("/api/settings", json={"spread_pct": "0.03"}).json()["spread_pct"] == "0.03"
    assert api.put("/api/demo/rate-override", json={"currency": "GBP", "rate": "123.50"}).json() == {"GBP": "123.50"}
    assert api.put("/api/demo/rate-override", json={"currency": "GBP", "rate": None}).json() == {}
    assert api.get("/api/summary").json()["open_proposals"] == 0


def test_webhook_rejects_unverified(s, monkeypatch):
    monkeypatch.setattr("app.main.paypal.verify_signature", lambda h, e: False)
    assert api.post("/api/webhooks/paypal", json={"id": "WH-X", "event_type": "INVOICING.INVOICE.PAID"}).status_code == 400
