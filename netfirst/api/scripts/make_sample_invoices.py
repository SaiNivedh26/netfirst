"""Generate the four scenario invoice PDFs, one per seeded client.

Run from netfirst/api:  uv run --with reportlab python scripts/make_sample_invoices.py
"""
import json
from decimal import Decimal
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

OUT = Path(__file__).parent.parent / "sample_invoices"
SYMBOL = {"GBP": "£", "EUR": "€", "USD": "$"}

INVOICES = [
    {
        "id": "01-marks-spencer-gbp", "number": "NF-2025-0101", "date": "2025-11-03", "due": "2025-12-03",
        "client": "Marks & Spencer", "email": "accounts@marks-spencer.example.com", "country": "GB",
        "address": ["Waterside House, 35 North Wharf Road", "London W2 1NW", "United Kingdom"],
        "currency": "GBP", "tax_rate": "0.20",
        "items": [("Retail analytics dashboard, sprint 1", "250.00"), ("Data pipeline setup", "138.18")],
        "label": "Marks & Spencer: CHARGE", "description": "New client, GBP to INR, FX line charged upfront",
    },
    {
        "id": "02-apple-green-gbp", "number": "NF-2025-0102", "date": "2025-11-04", "due": "2025-12-04",
        "client": "Apple Green Ltd", "email": "apple-green@example.com", "country": "GB",
        "address": ["Riverside House, Kings Reach Business Park", "Stockport SK4 2HD", "United Kingdom"],
        "currency": "GBP", "tax_rate": "0.20",
        "items": [("Campaign design retainer, November", "450.00"), ("Social asset production", "231.37")],
        "label": "Apple Green Ltd: TRUE_UP", "description": "Repeat client, GBP to INR, rate swing netted on payment",
    },
    {
        "id": "03-eurotech-eur", "number": "NF-2025-0103", "date": "2025-11-05", "due": "2025-12-05",
        "client": "Eurotech GmbH", "email": "invoices@eurotech-example.com", "country": "DE",
        "address": ["Friedrichstrasse 68", "10117 Berlin", "Germany"],
        "currency": "EUR", "tax_rate": None,
        "items": [("Managed services, November", "800.00"), ("Platform support hours", "400.00")],
        "label": "Eurotech GmbH: DEFER", "description": "Loyal client, EUR to INR, FX carried to balance",
    },
    {
        "id": "04-global-freight-usd", "number": "NF-2025-0104", "date": "2025-11-06", "due": "2025-12-06",
        "client": "Global Freight Co", "email": "billing@global-freight-example.com", "country": "US",
        "address": ["500 Harbor Boulevard", "Long Beach, CA 90802", "United States"],
        "currency": "USD", "tax_rate": None,
        "items": [("Fleet telemetry, November", "1500.00"), ("Route optimisation support", "600.00")],
        "label": "Global Freight Co: Settlement", "description": "Balance over cap, USD to INR, settlement follows",
    },
]


def money(ccy: str, v: Decimal) -> str:
    return f"{SYMBOL[ccy]}{v:,.2f}"


def totals(inv: dict) -> tuple[Decimal, Decimal, Decimal]:
    sub = sum(Decimal(a) for _, a in inv["items"])
    tax = (sub * Decimal(inv["tax_rate"])).quantize(Decimal("0.01")) if inv["tax_rate"] else Decimal(0)
    return sub, tax, sub + tax


def draw(inv: dict) -> None:
    ccy = inv["currency"]
    sub, tax, total = totals(inv)
    c = canvas.Canvas(str(OUT / f"{inv['id']}.pdf"), pagesize=A4)
    w, h = A4
    navy, muted = HexColor("#0b1f4d"), HexColor("#64748b")

    c.setFillColor(navy)
    c.setFont("Helvetica-Bold", 22)
    c.drawString(50, h - 70, "INVOICE")
    c.setFont("Helvetica", 10)
    c.setFillColor(muted)
    c.drawRightString(w - 50, h - 60, "Northwind Studio")
    c.drawRightString(w - 50, h - 74, "Freelance design and engineering, Bengaluru, India")
    c.drawRightString(w - 50, h - 88, "hello@northwind-studio.example.com")

    c.setFillColor(navy)
    c.setFont("Helvetica-Bold", 10)
    y = h - 140
    for label, value in [("Invoice number", inv["number"]), ("Invoice date", inv["date"]), ("Due date", inv["due"]), ("Currency", ccy)]:
        c.setFont("Helvetica-Bold", 10); c.drawString(50, y, label)
        c.setFont("Helvetica", 10); c.drawString(150, y, value)
        y -= 16

    c.setFont("Helvetica-Bold", 10)
    c.drawString(330, h - 140, "Bill to")
    c.setFont("Helvetica", 10)
    for i, line in enumerate([inv["client"], *inv["address"], inv["email"]]):
        c.drawString(330, h - 156 - i * 14, line)

    y = h - 260
    c.setFillColor(HexColor("#f1f5f9"))
    c.rect(50, y - 6, w - 100, 22, stroke=0, fill=1)
    c.setFillColor(navy)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(60, y, "Description")
    c.drawRightString(w - 60, y, f"Amount ({ccy})")
    c.setFont("Helvetica", 10)
    for name, amount in inv["items"]:
        y -= 24
        c.drawString(60, y, name)
        c.drawRightString(w - 60, y, money(ccy, Decimal(amount)))

    y -= 36
    rows = [("Subtotal", sub)] + ([(f"Tax ({int(Decimal(inv['tax_rate']) * 100)}% VAT)", tax)] if inv["tax_rate"] else []) + [("Total due", total)]
    for label, v in rows:
        bold = label == "Total due"
        c.setFont("Helvetica-Bold" if bold else "Helvetica", 11 if bold else 10)
        c.drawRightString(w - 160, y, label)
        c.drawRightString(w - 60, y, money(ccy, v))
        y -= 18
    if not inv["tax_rate"]:
        c.setFont("Helvetica", 9)
        c.setFillColor(muted)
        c.drawString(60, y - 6, "No tax charged: export of services.")

    c.setFont("Helvetica", 9)
    c.setFillColor(muted)
    c.drawString(50, 60, "Payment via PayPal. Thank you for your business.")
    c.save()


def main() -> None:
    manifest = []
    for inv in INVOICES:
        draw(inv)
        _, _, total = totals(inv)
        manifest.append({"id": inv["id"], "label": inv["label"], "description": inv["description"],
                         "client": inv["client"], "currency": inv["currency"], "amount": money(inv["currency"], total)})
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    print("\n".join(f"{m['id']}: {m['amount']}" for m in manifest))


if __name__ == "__main__":
    main()
