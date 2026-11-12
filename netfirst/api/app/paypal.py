"""PayPal REST: cached OAuth token, Invoicing v2 payloads from FX-engine minor units, webhook verification."""
import base64
import time
from datetime import datetime
import random
import string

import httpx

from .config import env
from .fx import to_major


class PayPalError(Exception):
    def __init__(self, status: int, path: str, body: str):
        super().__init__(f"PayPal {status} on {path}: {body[:500]}")
        self.status, self.body = status, body


_token: dict = {"value": None, "exp": 0.0}


def _access_token() -> str:
    if _token["value"] and time.time() < _token["exp"]:
        return _token["value"]
    basic = base64.b64encode(f"{env.PAYPAL_CLIENT_ID}:{env.PAYPAL_CLIENT_SECRET}".encode()).decode()
    res = httpx.post(
        f"{env.PAYPAL_BASE_URL}/v1/oauth2/token", data={"grant_type": "client_credentials"},
        headers={"Authorization": f"Basic {basic}"}, timeout=env.int("PAYPAL_TIMEOUT_SECONDS"),
    )
    if res.is_error:
        raise PayPalError(res.status_code, "/v1/oauth2/token", res.text)
    j = res.json()
    _token.update(value=j["access_token"], exp=time.time() + j["expires_in"] - 60)
    return _token["value"]


# ponytail: no retries; add backoff on 429/5xx if the sandbox proves flaky.
def call(method: str, path: str, body: dict | list | None = None, headers: dict | None = None) -> dict:
    res = httpx.request(
        method, f"{env.PAYPAL_BASE_URL}{path}", json=body, timeout=env.int("PAYPAL_TIMEOUT_SECONDS"),
        headers={"Authorization": f"Bearer {_access_token()}", **(headers or {})},
    )
    if res.is_error:
        raise PayPalError(res.status_code, path, res.text)
    return res.json() if res.content else {}


def invoice_payload(
    *, currency: str, email: str, note: str, items: list[tuple[str, int]],
    discount_minor: int = 0, invoice_number: str | None = None, due_date: datetime | None = None,
    name: str | None = None,
) -> dict:
    def money(minor: int) -> dict:
        return {"currency_code": currency, "value": to_major(minor, currency)}

    term = {"term_type": "DUE_ON_DATE_SPECIFIED", "due_date": due_date.date().isoformat()} if due_date else {"term_type": env.PAYPAL_PAYMENT_TERM}
    billing: dict = {"email_address": email}
    if name:
        billing["business_name"] = name
    payload = {
        "detail": {"currency_code": currency, "note": note, "payment_term": term} | ({"invoice_number": invoice_number} if invoice_number else {}),
        "invoicer": {},
        "primary_recipients": [{"billing_info": billing}],
        "items": [{"name": item_name, "quantity": "1", "unit_amount": money(minor)} for item_name, minor in items if minor > 0],
    }
    if discount_minor:
        payload["amount"] = {"breakdown": {"discount": {"invoice_discount": {"amount": money(discount_minor)}}}}
    return payload


def _unique_suffix() -> str:
    return "".join(random.choices(string.digits, k=4))


def create_draft(payload: dict) -> dict:
    try:
        return call("POST", "/v2/invoicing/invoices", payload, {"Prefer": "return=representation"})
    except PayPalError as e:
        if e.status == 422 and "DUPLICATE_INVOICE_NUMBER" in e.body:
            # Append a 4-digit suffix to make the number unique and retry once.
            detail = payload.setdefault("detail", {})
            base = detail.get("invoice_number") or ""
            detail["invoice_number"] = f"{base}-{_unique_suffix()}"
            return call("POST", "/v2/invoicing/invoices", payload, {"Prefer": "return=representation"})
        raise


def send_and_get_link(invoice_id: str) -> str | None:
    """The payer link lives in the invoice metadata after sending."""
    call("POST", f"/v2/invoicing/invoices/{invoice_id}/send", {"send_to_invoicer": False})
    inv = call("GET", f"/v2/invoicing/invoices/{invoice_id}")
    return inv.get("detail", {}).get("metadata", {}).get("recipient_view_url")


def verify_signature(headers: dict, event: dict) -> bool:
    h = {k.lower(): v for k, v in headers.items()}
    r = call("POST", "/v1/notifications/verify-webhook-signature", {
        "auth_algo": h.get("paypal-auth-algo"), "cert_url": h.get("paypal-cert-url"),
        "transmission_id": h.get("paypal-transmission-id"), "transmission_sig": h.get("paypal-transmission-sig"),
        "transmission_time": h.get("paypal-transmission-time"), "webhook_id": env.PAYPAL_WEBHOOK_ID, "webhook_event": event,
    })
    return r.get("verification_status") == "SUCCESS"
