"""First-hour sandbox smoke test: OAuth, Currency Exchange quote, a draft per currency, send, payer link.
Run from netfirst/api:  uv run python -m scripts.smoke"""
import json

from app import paypal
from app.config import env


def step(name, fn):
    try:
        r = fn()
        print(f"PASS {name}\n{json.dumps(r, indent=2)[:1500]}\n")
        return r
    except Exception as e:  # report every step, keep going
        print(f"FAIL {name}\n{e}\n")


step("quote GBP->INR (Currency Exchange API)", lambda: paypal.call(
    "POST", "/v2/pricing/quote-exchange-rates",
    {"quote_items": [{"base_currency": "GBP", "base_amount": "100.00", "quote_currency": "INR"}]}))


def draft(currency, work_minor, fx_minor):
    return lambda: paypal.create_draft(paypal.invoice_payload(
        currency=currency, email=env.SMOKE_RECIPIENT_EMAIL, note="NetFirst smoke test",
        items=[("Brand kit", work_minor), ("FX and processing", fx_minor)]))


gbp = step("create GBP draft", draft("GBP", 40000, 3359))
step("create EUR draft", draft("EUR", 46000, 3863))
step("create JPY draft (zero-decimal)", draft("JPY", 60000, 5037))
if gbp:
    step("send GBP invoice + fetch payer link", lambda: {"id": gbp["id"], "payer_link": paypal.send_and_get_link(gbp["id"])})
