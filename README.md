# PayPal Stock Trading Agent

An autonomous CLI agent that analyzes stocks via Yahoo Finance and executes PayPal sandbox payouts based on market signals.

**Stack:** agno · Groq (`openai/gpt-oss-20b`) · yfinance · PayPal Payouts REST API

---

## What it does

1. Fetches real-time stock data (price, 30-day return, PE ratio, analyst recommendation) for a configurable list of tickers
2. The LLM decides how much of the day's budget to deploy based on signal strength
3. Executes a PayPal sandbox payout if warranted — with hard budget guardrails
4. Writes a full audit trail to `audit.log`

---

## Setup

### 1. PayPal Developer App

> **Requirement:** The sender account must be **United States**-based. India (IN) accounts are not supported as Payouts senders.

- Go to [developer.paypal.com](https://developer.paypal.com) → Testing Tools → Sandbox Accounts → **Create Account** (Business, Country: US)
- Apps & Credentials → **Create App** → Type: **Merchant** → select the US sandbox account
- Under Features, enable ✅ **Payouts**
- Copy the sandbox **Client ID** and **Client Secret**

### 2. Environment variables

Create a `.env` file in the project root:

```env
PAYPAL_CLIENT_ID=your_sandbox_client_id
PAYPAL_CLIENT_SECRET=your_sandbox_client_secret
PAYPAL_SENDER_EMAIL=your_us_sandbox_business@example.com
PAYPAL_RECEIVER_EMAIL=payouts-simulator-receiver@paypal.com
GROQ_API_KEY=your_groq_api_key
```

### 3. Install dependencies

```bash
source pay/bin/activate
pip install agno groq yfinance python-dotenv requests
```

---

## Run

```bash
source pay/bin/activate && python trading_agent.py
```

---

## Budget guardrails

The agent can never exceed its budget — enforced at three independent layers:

| Layer | What it enforces |
|-------|-----------------|
| Tool hard cap | Single payout ≤ 40% of budget ($40 max on $100) |
| Session tracker | Cumulative spend ≤ 80% of budget; 20% always kept as reserve |
| Agent instructions | LLM told to stop (not retry) if a payout is rejected |

All payout attempts — successful or rejected — are written to `audit.log`.

---

## Audit log

Each run appends JSON lines to `audit.log`:

```json
{"ts": "2026-11-11T...", "event": "payout_sent", "amount": 30.0, "batch_id": "...", "spent_so_far": 30.0}
{"ts": "2026-11-11T...", "event": "agent_summary", "summary": "AAPL +2.2% with buy rec..."}
```

Verify transactions in the PayPal Developer Dashboard → Sandbox Accounts → check balance on both accounts.

---

## Configuration

Edit the constants at the top of `trading_agent.py`:

```python
BUDGET = 100.0          # total budget for the session (USD)
RESERVE_PCT = 0.20      # fraction always kept undeployed
MAX_SINGLE_TRADE_PCT = 0.40  # max fraction per single payout
STOCKS = ["AAPL", "MSFT", "NVDA", "TSLA"]  # tickers to analyze
```
