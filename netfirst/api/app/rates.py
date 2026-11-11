"""Rate sources: demo override (payment day only) -> PayPal quote (added after the sandbox smoke test) -> ECB."""
import re
import time
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, localcontext
from typing import NamedTuple

import httpx

from .config import env
from .fx import D, cross_rate


class Quote(NamedTuple):
    rate: Decimal
    source: str  # ECB, PAYPAL, DEMO_OVERRIDE
    date: str


def parse_ecb(xml: str) -> list[dict]:
    """ECB <Cube time=..><Cube currency=.. rate=../>.. blocks, newest first, with EUR=1 (units per EUR)."""
    days = []
    for day, body in re.findall(r"""<Cube time=["']([\d-]+)["']>(.*?)</Cube>""", xml, re.S):
        eur = {"EUR": "1"} | dict(re.findall(r"""currency=["'](\w+)["'] rate=["']([\d.]+)["']""", body))
        days.append({"date": day, "eur": eur})
    return days


def _sig(x: Decimal) -> Decimal:
    """Price and store with the same precision (SQLite has no exact decimal type)."""
    with localcontext() as ctx:
        ctx.prec, ctx.rounding = env.int("RATE_SIGNIFICANT_DIGITS"), ROUND_HALF_UP
        return +x


def rate_on(days: list[dict], frm: str, to: str, on: str | None = None) -> Quote:
    day = next((d for d in days if on is None or d["date"] <= on), None)
    if day is None:
        raise ValueError(f"No ECB rates on or before {on}")
    f, t = day["eur"].get(frm), day["eur"].get(to)
    if not f or not t:
        raise ValueError(f"ECB has no rate for {frm}->{to}")
    return Quote(_sig(cross_rate(f, t)), "ECB", day["date"])


_cache: dict = {"at": 0.0, "days": []}


def _ecb_days() -> list[dict]:
    # ponytail: per-process cache; fine for one Render instance.
    if time.time() - _cache["at"] > env.int("RATES_CACHE_SECONDS"):
        res = httpx.get(env.ECB_RATES_URL, timeout=env.int("PAYPAL_TIMEOUT_SECONDS"))
        res.raise_for_status()
        _cache.update(at=time.time(), days=parse_ecb(res.text))
    return _cache["days"]


def quote(frm: str, to: str) -> Quote:
    return rate_on(_ecb_days(), frm, to)


# Demo-only and labelled: overrides the payment-day output->base rate for one output currency.
_overrides: dict[str, str] = {}


def set_override(currency: str, rate: str | None) -> None:
    if rate is None:
        _overrides.pop(currency, None)
    else:
        D(rate)  # reject non-numbers early
        _overrides[currency] = rate


def get_overrides() -> dict[str, str]:
    return dict(_overrides)


def payment_day(output: str, base: str) -> Quote:
    if output in _overrides:
        return Quote(_sig(D(_overrides[output])), "DEMO_OVERRIDE", date.today().isoformat())
    return quote(output, base)
