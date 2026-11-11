from app.fx import (balance, convert, cross_rate, exp, fx_line, gross_up, invert, is_currency, price_invoice,
                    settlement_invoice, to_major, to_minor, true_up_base)
from types import SimpleNamespace as E

FEE, SPREAD = "0.044", "0.035"


def test_base_conversion():  # ₹44,000 at 110 → £400.00
    assert convert(4400000, "INR", "GBP", invert(110)) == 40000


def test_gross_up():  # factor (1−0.044)(1−0.035) = 0.92254
    assert gross_up(40000, FEE, SPREAD) == 43359
    assert fx_line(40000, FEE, SPREAD) == 3359
    assert to_major(43359, "GBP") == "433.59"


def test_true_up_both_directions():
    assert true_up_base(40000, "GBP", "INR", 110, 107) == 120000
    assert true_up_base(40000, "GBP", "INR", 110, 112) == -80000


def test_balance_ignores_invoice_and_payment():
    entries = [E(type="INVOICE", amount_minor=4769600), E(type="TRUE_UP", amount_minor=120000),
               E(type="PAYMENT", amount_minor=4280000), E(type="TRUE_UP", amount_minor=-80000)]
    assert balance(entries) == 40000


def test_settlement_is_grossed_up():
    assert settlement_invoice(40000, "INR", "GBP", invert(110), FEE, SPREAD) == {"output_base_minor": 364, "gross_minor": 395}


def test_exponents_and_zero_decimal():
    assert [exp("JPY"), exp("USD"), exp("KWD"), exp("HUF")] == [0, 2, 3, 0]
    assert convert(123456, "USD", "JPY", "150.5") == 185801
    assert to_major(185801, "JPY") == "185801"
    assert to_minor("5000", "INR") == 500000


def test_cross_rate_matches_direct():
    via_eur = convert(123456, "USD", "JPY", cross_rate("1.0812", "162.71"))
    direct = convert(123456, "USD", "JPY", "150.4902")
    assert abs(via_eur - direct) <= 1


def test_half_up_both_signs():
    assert convert(1, "GBP", "GBP", "0.5") == 1
    assert convert(-1, "GBP", "GBP", "0.5") == -1
    assert convert(5, "GBP", "GBP", "0.3") == 2


def test_currency_validation():
    assert is_currency("GBP") and not is_currency("XYZ") and not is_currency("gbp")


BASE = dict(source_minor=4400000, source="INR", output="GBP", base="INR", rate_source_to_output=invert(110),
            rate_output_to_base=110, fee=FEE, spread=SPREAD)


def test_price_true_up():
    r = price_invoice(**BASE, treatment="TRUE_UP")
    assert (r["output_base_minor"], r["fx_line_minor"], r["gross_minor"], r["defer_base_minor"]) == (40000, 3359, 43359, 0)


def test_price_defer_moves_fx_line_to_balance():
    r = price_invoice(**BASE, treatment="DEFER")
    assert (r["fx_line_minor"], r["gross_minor"], r["defer_base_minor"]) == (0, 40000, 369490)


def test_price_credit_discount_capped():
    r = price_invoice(**BASE, treatment="CHARGE", credit_base_minor=80000)  # ₹800 → £7.27
    assert r["discount_minor"] == 727
    assert r["gross_minor"] == gross_up(40000 - 727, FEE, SPREAD)
    assert price_invoice(**BASE, treatment="CHARGE", credit_base_minor=99999999)["gross_minor"] == 0


def test_price_same_currency_and_fee_only():
    assert price_invoice(**(BASE | dict(output="INR", rate_source_to_output=1, rate_output_to_base=1)), treatment="CHARGE")["fx_line_minor"] == 0
    r = price_invoice(**(BASE | dict(source="USD", source_minor=10000, output="INR", rate_source_to_output=88, rate_output_to_base=1)), treatment="CHARGE")
    assert r["fx_line_minor"] == gross_up(880000, FEE, 0) - 880000


def test_price_any_to_any_usd_to_jpy():
    r = price_invoice(source_minor=123456, source="USD", output="JPY", base="INR", rate_source_to_output="150.5",
                      rate_output_to_base="0.585", treatment="CHARGE", fee=FEE, spread=SPREAD)
    assert r["output_base_minor"] == 185801 and r["gross_minor"] == gross_up(185801, FEE, SPREAD)
