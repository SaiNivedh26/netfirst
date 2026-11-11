"""
PayPal Stock Trading Agent
Analyzes stocks via yfinance, decides allocation, and executes PayPal sandbox payout.
"""

import json
import os
import uuid
from datetime import datetime, timezone

import requests
import yfinance as yf
from dotenv import load_dotenv

from agno.agent import Agent
from agno.models.groq import Groq

load_dotenv()

# --- Config ---
PAYPAL_BASE = "https://api-m.sandbox.paypal.com"
PAYPAL_CLIENT_ID = os.environ["PAYPAL_CLIENT_ID"]
PAYPAL_CLIENT_SECRET = os.environ["PAYPAL_CLIENT_SECRET"]
PAYPAL_RECEIVER_EMAIL = os.environ["PAYPAL_RECEIVER_EMAIL"]
AUDIT_LOG = os.path.join(os.path.dirname(__file__), "audit.log")

BUDGET: float = 100.0
RESERVE_PCT: float = 0.20       # 20% always kept back
MAX_SINGLE_TRADE_PCT: float = 0.40  # max 40% of budget per single payout
MIN_SINGLE_TRADE: float = 1.00

session_spent: float = 0.0


# ---------------------------------------------------------------------------
# PayPal helpers
# ---------------------------------------------------------------------------

def _get_paypal_access_token() -> str:
    resp = requests.post(
        f"{PAYPAL_BASE}/v1/oauth2/token",
        auth=(PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        data={"grant_type": "client_credentials"},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


# ---------------------------------------------------------------------------
# Agent tools
# ---------------------------------------------------------------------------

def analyze_stocks(tickers: list) -> str:
    """
    Fetch key metrics for each ticker via yfinance.
    Returns a JSON string with price, 30-day return, PE ratio, and analyst target.
    """
    results = {}
    for ticker in tickers:
        try:
            t = yf.Ticker(ticker)
            info = t.info
            hist = t.history(period="1mo")
            ret_30d = None
            if len(hist) >= 2:
                ret_30d = round((hist["Close"].iloc[-1] / hist["Close"].iloc[0] - 1) * 100, 2)
            results[ticker] = {
                "price": info.get("currentPrice") or info.get("regularMarketPrice"),
                "return_30d_pct": ret_30d,
                "pe_ratio": info.get("trailingPE"),
                "analyst_target": info.get("targetMeanPrice"),
                "recommendation": info.get("recommendationKey"),
            }
        except Exception as e:
            results[ticker] = {"error": str(e)}
    return json.dumps(results, indent=2)


def send_paypal_payout(amount: float, note: str) -> str:
    """
    Send a PayPal sandbox payout to the receiver account.
    Enforces hard budget caps before making any API call.
    Returns JSON with batch_id and status, or an error message.
    """
    global session_spent

    # --- Layer 1: hard per-trade cap ---
    max_single = BUDGET * MAX_SINGLE_TRADE_PCT
    if amount < MIN_SINGLE_TRADE:
        reason = f"amount ${amount:.2f} below minimum ${MIN_SINGLE_TRADE:.2f}"
        _write_audit_log({"event": "payout_rejected", "requested": amount, "reason": reason, "spent_so_far": session_spent})
        return json.dumps({"status": "rejected", "reason": reason})

    if amount > max_single:
        reason = f"amount ${amount:.2f} exceeds single-trade cap ${max_single:.2f}"
        _write_audit_log({"event": "payout_rejected", "requested": amount, "reason": reason, "spent_so_far": session_spent})
        return json.dumps({"status": "rejected", "reason": reason})

    # --- Layer 2: cumulative session cap ---
    remaining = BUDGET - session_spent
    deployable = remaining * (1 - RESERVE_PCT)
    if amount > deployable:
        reason = (
            f"amount ${amount:.2f} would exceed deployable budget "
            f"(spent ${session_spent:.2f}, deployable ${deployable:.2f})"
        )
        _write_audit_log({"event": "payout_rejected", "requested": amount, "reason": reason, "spent_so_far": session_spent})
        return json.dumps({"status": "rejected", "reason": reason})

    # --- Proceed with API call ---
    try:
        token = _get_paypal_access_token()
        batch_id = str(uuid.uuid4())
        payload = {
            "sender_batch_header": {
                "sender_batch_id": batch_id,
                "email_subject": "Stock Trading Agent Payout",
                "email_message": note,
            },
            "items": [
                {
                    "recipient_type": "EMAIL",
                    "receiver": PAYPAL_RECEIVER_EMAIL,
                    "amount": {"currency": "USD", "value": f"{amount:.2f}"},
                    "note": note,
                    "sender_item_id": str(uuid.uuid4()),
                }
            ],
        }
        resp = requests.post(
            f"{PAYPAL_BASE}/v1/payments/payouts",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
            },
            json=payload,
            timeout=20,
        )
        resp.raise_for_status()
        data = resp.json()
        batch_status = data.get("batch_header", {}).get("batch_status", "UNKNOWN")
        payout_batch_id = data.get("batch_header", {}).get("payout_batch_id", batch_id)

        session_spent += amount
        _write_audit_log({
            "event": "payout_sent",
            "amount": amount,
            "batch_id": payout_batch_id,
            "receiver": PAYPAL_RECEIVER_EMAIL,
            "note": note,
            "batch_status": batch_status,
            "spent_so_far": session_spent,
        })
        return json.dumps({
            "status": "success",
            "batch_id": payout_batch_id,
            "batch_status": batch_status,
            "amount_sent": amount,
            "spent_so_far": session_spent,
        })

    except requests.HTTPError as e:
        err = f"PayPal API error: {e.response.status_code} {e.response.text}"
        _write_audit_log({"event": "payout_error", "requested": amount, "error": err, "spent_so_far": session_spent})
        return json.dumps({"status": "error", "error": err})


def write_audit_log(summary: str) -> str:
    """
    Write a free-form audit entry (agent reasoning / final summary).
    """
    _write_audit_log({"event": "agent_summary", "summary": summary, "spent_so_far": session_spent})
    return "Audit entry written."


def _write_audit_log(entry: dict) -> None:
    entry["ts"] = datetime.now(timezone.utc).isoformat()
    with open(AUDIT_LOG, "a") as f:
        f.write(json.dumps(entry) + "\n")


# ---------------------------------------------------------------------------
# Agent setup
# ---------------------------------------------------------------------------

STOCKS = ["AAPL", "MSFT", "NVDA", "TSLA"]

agent = Agent(
    model=Groq(id="openai/gpt-oss-20b"),
    tools=[analyze_stocks, send_paypal_payout, write_audit_log],
    instructions=f"""You are an autonomous stock trading agent operating with a sandbox PayPal account.

Your task each run:
1. Call analyze_stocks with the provided tickers to get market data.
2. Assess each stock's signal strength based on 30-day return, PE ratio vs analyst target, and recommendation.
3. Decide how much of today's budget to deploy (can be $0 if no clear signal).
4. If deploying > $0, call send_paypal_payout ONCE with the total amount and a note explaining your reasoning.
5. Call write_audit_log with a summary: stocks analyzed, your thesis, amount decided, and outcome.

BUDGET RULES — these are hard constraints, not guidelines:
- Total deployed today must NOT exceed ${BUDGET * (1 - RESERVE_PCT):.2f} ({int((1-RESERVE_PCT)*100)}% of ${BUDGET:.2f} budget; {int(RESERVE_PCT*100)}% is a hard reserve).
- A single payout must NOT exceed ${BUDGET * MAX_SINGLE_TRADE_PCT:.2f} ({int(MAX_SINGLE_TRADE_PCT*100)}% of budget).
- If send_paypal_payout returns "rejected", do NOT retry with a different amount — log the rejection and stop.
- Prefer smaller, high-conviction allocations. Deploy $0 if no stock has a clear bullish signal.
- Be conservative: a stock needs at least a positive 30-day return AND a buy/strong_buy recommendation to qualify.
""",
    markdown=True,
)

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print(f"\n{'='*60}")
    print(f"  PayPal Stock Trading Agent")
    print(f"  Budget: ${BUDGET:.2f} | Reserve: {int(RESERVE_PCT*100)}% | Max/trade: {int(MAX_SINGLE_TRADE_PCT*100)}%")
    print(f"  Stocks: {STOCKS}")
    print(f"  Audit log: {AUDIT_LOG}")
    print(f"{'='*60}\n")

    agent.print_response(
        f"Analyze these stocks: {STOCKS}. "
        f"Budget for today: ${BUDGET:.2f}. "
        f"Make a trading decision and execute a PayPal payout if warranted.",
        stream=True,
    )

    print(f"\n{'='*60}")
    print(f"  Session complete. Total spent: ${session_spent:.2f} / ${BUDGET:.2f}")
    print(f"{'='*60}\n")
