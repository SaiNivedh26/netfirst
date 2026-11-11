from decimal import Decimal

from app.rates import parse_ecb, payment_day, rate_on, set_override

XML = """<Cube><Cube time='2026-11-10'>
  <Cube currency='GBP' rate='0.83545'/><Cube currency='INR' rate='105.3315'/></Cube>
<Cube time="2026-11-09"><Cube currency="GBP" rate="0.8351"/></Cube></Cube>"""


def test_parse_ecb_both_quote_styles():
    assert parse_ecb(XML) == [
        {"date": "2026-11-10", "eur": {"EUR": "1", "GBP": "0.83545", "INR": "105.3315"}},
        {"date": "2026-11-09", "eur": {"EUR": "1", "GBP": "0.8351"}},
    ]


def test_cross_rate_rounded_to_configured_digits():
    assert rate_on(parse_ecb(XML), "GBP", "INR").rate == Decimal("126.0775630")


def test_override_is_labelled():
    set_override("GBP", "123.50")
    try:
        assert payment_day("GBP", "INR")[:2] == (Decimal("123.50"), "DEMO_OVERRIDE")
    finally:
        set_override("GBP", None)
