"""The only module that does money arithmetic. Pure and deterministic.

Amounts are int minor units of their currency; a rate is "units of `to` per 1 unit of `from`".
Rounding is half-up (away from zero) everywhere.
"""
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from babel.numbers import format_currency, get_currency_precision
from babel.numbers import is_currency as _babel_is_currency

from .config import env

Treatment = Literal["CHARGE", "TRUE_UP", "DEFER"]
Rate = Decimal | str | int
FX_BALANCE_TYPES = {"TRUE_UP", "FX_DEFER", "SETTLEMENT", "CREDIT_APPLIED"}


def D(x: Rate) -> Decimal:
    return x if isinstance(x, Decimal) else Decimal(str(x))


def is_currency(c: str) -> bool:
    return len(c) == 3 and c.isupper() and _babel_is_currency(c)


def exp(c: str) -> int:
    return 0 if c in env.list("PAYPAL_ZERO_DECIMAL_CURRENCIES") else get_currency_precision(c)


def _round(x: Decimal) -> int:
    return int(x.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def convert(minor: int, frm: str, to: str, rate: Rate) -> int:
    return _round(Decimal(minor) * D(rate) * Decimal(10) ** (exp(to) - exp(frm)))


def invert(rate: Rate) -> Decimal:
    return Decimal(1) / D(rate)


def cross_rate(eur_to_from: Rate, eur_to_to: Rate) -> Decimal:
    """ECB publishes units per EUR; from→to = eur[to] / eur[from]."""
    return D(eur_to_to) / D(eur_to_from)


def gross_up(minor: int, fee: Rate, spread: Rate) -> int:
    return _round(Decimal(minor) / ((1 - D(fee)) * (1 - D(spread))))


def fx_line(minor: int, fee: Rate, spread: Rate) -> int:
    return gross_up(minor, fee, spread) - minor


def true_up_base(output_base_minor: int, output: str, base: str, rate_invoiced: Rate, rate_paid: Rate) -> int:
    """+ client owes user, − user owes client. Measured in base currency."""
    return convert(output_base_minor, output, base, rate_invoiced) - convert(output_base_minor, output, base, rate_paid)


def balance(entries) -> int:
    """Entries need .type and .amount_minor; INVOICE and PAYMENT are informational."""
    return sum(e.amount_minor for e in entries if e.type in FX_BALANCE_TYPES)


def settlement_invoice(balance_base_minor: int, base: str, output: str, rate_base_to_output: Rate, fee: Rate, spread: Rate) -> dict:
    """Settlement invoices are paid through PayPal too, so they are grossed up."""
    output_base_minor = convert(balance_base_minor, base, output, rate_base_to_output)
    return {"output_base_minor": output_base_minor, "gross_minor": gross_up(output_base_minor, fee, 0 if output == base else spread)}


def to_major(minor: int, c: str) -> str:
    return f"{Decimal(minor).scaleb(-exp(c)):.{exp(c)}f}"


def to_minor(major: Rate, c: str) -> int:
    return _round(D(major).scaleb(exp(c)))


def fmt(minor: int, c: str) -> str:
    return format_currency(Decimal(to_major(minor, c)), c, locale=env.DISPLAY_LOCALE)


def price_invoice(
    *, source_minor: int, source: str, output: str, base: str, rate_source_to_output: Rate, rate_output_to_base: Rate,
    treatment: Treatment, fee: Rate, spread: Rate, credit_base_minor: int = 0,
) -> dict:
    """credit_base_minor > 0 is credit owed to the client, applied as a discount (capped at the invoice)."""
    output_base_minor = convert(source_minor, source, output, rate_source_to_output)
    credit = convert(credit_base_minor, base, output, invert(rate_output_to_base))
    discount_minor = min(max(credit, 0), output_base_minor)
    net = output_base_minor - discount_minor
    all_same = source == output == base
    fx = 0 if all_same else fx_line(net, fee, 0 if output == base else spread)
    fx_line_minor = 0 if treatment == "DEFER" else fx
    return {
        "output_base_minor": output_base_minor,
        "discount_minor": discount_minor,
        "fx_line_minor": fx_line_minor,
        "gross_minor": net + fx_line_minor,
        "defer_base_minor": convert(fx, output, base, rate_output_to_base) if treatment == "DEFER" else 0,
        "credit_applied_base_minor": convert(discount_minor, output, base, rate_output_to_base),
    }
