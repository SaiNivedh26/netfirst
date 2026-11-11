# NetFirst

**Agentic, currency-agnostic invoicing on PayPal: upload your invoice PDF, get paid what you actually charged.**

Built for *Build What's Next with PayPal and AI* (Devpost, November 2026).

Cross-border PayPal payments quietly lose about 7–9% to the receiving fee and the conversion markup, and freelancers usually guess at a 3–5% buffer to cover it. NetFirst adds the FX cost to the invoice as a visible line, records how the exchange rate actually moved between invoicing and payment, and nets those gains and losses per client, so the leftover settles on one small invoice instead of padding every bill.

---

## Status

| Area | State |
|---|---|
| Invoice agent (PDF → PayPal draft) | ✅ Working against the PayPal sandbox and Groq, tested on real invoice PDFs |
| FX engine, ledger, true-up, settlement rules | ✅ Built and unit-tested |
| PayPal Invoicing v2 (draft, send, payer link) | ✅ Verified in sandbox for GBP, EUR and JPY |
| PayPal Currency Exchange quote | ⚠️ Not provisioned on our sandbox account (`FEATURE_NOT_PROVISIONED`); ECB rates are used and labelled |
| Paid webhook → true-up | ✅ Built and tested with a replayed event; live webhook needs a public URL (use the `/sync` fallback locally) |
| Settlement agent, payment follow-up agent, ask-the-ledger | 🔜 Planned (see [Where the AI goes next](#where-the-ai-goes-next)) |
| React + AG Grid console | 🔜 Planned |

---

## How it works

1. **Upload** your usual invoice PDF, made in any tool, priced in any currency.
2. **The agent reads it**, validates the fields, matches or creates the client, and asks one question if something essential (like the client's email) is missing.
3. **It prices the invoice** in the client's currency through the FX engine: the work amount plus an "FX and processing" line covering PayPal's fee and conversion spread.
4. **It picks a treatment** for future rate swings and writes a one-line reason the client can read.
5. **It creates a PayPal draft.** Nothing is sent until you click approve.
6. **When the client pays**, NetFirst records the payment-day rate and posts the gain or loss to that client's running FX balance. Balances settle on one PayPal invoice when they reach a cap, get too old, or at quarter end; a negative balance becomes a discount on the next invoice.

### Three currencies

| Currency | Meaning | Comes from |
|---|---|---|
| Source | What the work was priced in | Read from the PDF |
| Output | What the client is invoiced in and pays | The client's usual currency, or the user's choice |
| Base | The user's bookkeeping currency | Settings (`BASE_CURRENCY`) |

### Three treatments

| Treatment | FX line (fee + spread) | Rate swing before payment | For |
|---|---|---|---|
| `CHARGE` | On the invoice | Absorbed, not tracked | New or slow-paying clients |
| `TRUE_UP` | On the invoice | Posted to the client's balance | Repeat clients |
| `DEFER` | Posted to the balance | Posted to the balance | Loyal clients, under a cap |

---

## The AI part

The invoice agent is an [agno](https://github.com/agno-agi/agno) agent running on Groq (`GROQ_MODEL`, default `openai/gpt-oss-120b`). The model reads, decides and explains; deterministic tools do every calculation and every PayPal call.

**What the model decides today**

- **Reads messy PDFs.** Turns unstructured invoice text (odd layouts, tax lines, three-decimal amounts) into structured fields.
- **Knows what's missing.** Asks the user one question when an essential field such as the client email is absent, instead of guessing.
- **Matches or creates the client** from what it read.
- **Chooses the treatment** and writes the reason shown on the PayPal invoice.

**What the model is never allowed to do**

- Compute or pass amounts: `price_invoice` computes them and `create_paypal_draft` uses only that result.
- Send an invoice: sending is not a tool; only the approve endpoint sends.
- Bypass the guardrails: `check_policy` is re-checked at draft time (fewer than `POLICY_TRUE_UP_MIN_PAID` paid invoices forces `CHARGE`; `DEFER` needs `POLICY_DEFER_MIN_PAID` and a balance under the cap).

Every tool call is recorded through agno's `tool_hooks` into a step trace the UI shows live. Runs are bounded by `AGENT_TOOL_CALL_LIMIT` and `AGENT_TIMEOUT_SECONDS`.

**Agent tools:** `validate_extraction`, `find_client`, `propose_client`, `get_client_history`, `get_fx_quote`, `price_invoice`, `check_policy`, `create_paypal_draft`, `ask_user`.

### Where the AI goes next

Today the agent follows a fixed sequence and mostly works up to the draft. The next steps give it real decisions over time, while code still does the money:

| Planned | What the agent decides |
|---|---|
| Treatment from real behaviour | `CHARGE` / `TRUE_UP` / `DEFER` from the client's payment speed, currency volatility and balance; the rules become limits, not the decision |
| Settlement agent | Across all clients: who to settle now, who to wait for, who to net against a credit; drafts the PayPal settlement invoices and client notes for approval |
| Payment follow-up agent | For overdue invoices: send a PayPal reminder, re-quote after a big rate move, or flag to the user |
| Ask the ledger | Plain-English questions answered with figures plus AG Grid filters |

---

## How PayPal is used

| PayPal API | Role |
|---|---|
| Invoicing v2 | Drafts with the FX line, send, payer link, discounts for credits, settlement invoices |
| Webhooks | `INVOICING.INVOICE.PAID` triggers the payment-day true-up (signature verified) |
| Currency Exchange quote | Intended rate source; not provisioned on our sandbox account, so ECB reference rates are used and labelled on every invoice |
| Payouts (stretch) | Paying the net amount when the user owes a client |

---

## Stack

Python 3.13 · FastAPI · SQLModel + SQLite · agno + Groq · pypdf · Babel (ISO currency precision) · httpx · pytest · managed with [uv](https://docs.astral.sh/uv/).

```
netfirst/
  .env.example          every tunable, documented (the code has no defaults)
  api/
    app/
      config.py         env access; fails loudly on missing keys
      fx.py             FX engine: the only money arithmetic (Decimal, half-up, minor units)
      rates.py          ECB rates, labelled demo override for the payment day
      paypal.py         OAuth, Invoicing v2 payloads, webhook verification
      ledger.py         posting rules, guardrails, settle proposals, paid handler
      agent.py          agno + Groq invoice agent and its tools
      models.py         tables
      main.py           FastAPI routes
    scripts/smoke.py    sandbox smoke test
    tests/              pytest suite
```

Amounts are integers in each currency's minor units (JPY 0 decimals, KWD 3); balances are always derived from an append-only ledger.

---

## Setup

### 1. PayPal sandbox

At [developer.paypal.com](https://developer.paypal.com), with **Sandbox** selected:

1. **Testing Tools → Sandbox Accounts → Create account**: a **Business** account in the **United States** (India business sandbox accounts are restricted).
2. **Create account** again: a **Personal** account in the **United Kingdom** (the paying client). Note its email and password from *View/edit account*.
3. **Apps & Credentials → Create App**: type **Merchant**, linked to the US business account, with **Invoicing** enabled under Features. Copy the Client ID and Secret.

### 2. Groq

Create an API key at [console.groq.com](https://console.groq.com).

### 3. Configure

```bash
cp netfirst/.env.example netfirst/.env
# fill PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, GROQ_API_KEY, SMOKE_RECIPIENT_EMAIL (the UK personal account)
```

Every other value in `.env.example` is a documented default you can change: fees, spread, guardrail thresholds, client caps, model, timeouts, rate source URL, payment term.

### 4. Install, test, run

```bash
cd netfirst/api
uv sync
uv run pytest                       # unit + DB-backed tests, no network
uv run python -m scripts.smoke      # checks your sandbox: OAuth, drafts in GBP/EUR/JPY, send, payer link
uv run uvicorn app.main:app --reload
```

API docs are at http://localhost:8000/docs.

### 5. Webhooks (optional locally)

PayPal needs a public HTTPS URL:

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:8000
```

Add a sandbox webhook on your app for `https://<tunnel>/api/webhooks/paypal` with the *Invoice paid* and *Invoice cancelled* events, and put its ID in `PAYPAL_WEBHOOK_ID`. Without a webhook, `POST /api/invoices/{id}/sync` reads the status from PayPal and posts the payment and true-up the same way.

---

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/agent/runs` | Upload a PDF (multipart `file`, optional `output_currency`); starts the agent |
| GET | `/api/agent/runs/{id}` | Status, extracted fields, step trace, draft |
| POST | `/api/agent/runs/{id}/answer` | Answer the agent's question and resume |
| POST | `/api/agent/runs/{id}/reprice` | Change output currency or treatment on the draft |
| POST | `/api/agent/runs/{id}/approve` | Send the PayPal invoice and post ledger entries |
| GET | `/api/clients` | Client ledger rows with derived balances |
| POST | `/api/clients` | Add a client |
| GET | `/api/clients/{id}/invoices` | Invoices for one client |
| GET | `/api/summary` | Summary figures |
| GET | `/api/proposals` | Open settle proposals |
| POST | `/api/proposals/{id}/approve` · `/dismiss` | Act on a proposal |
| POST | `/api/webhooks/paypal` | Verified PayPal webhook |
| POST | `/api/invoices/{id}/sync` | Pull paid status from PayPal (webhook fallback) |
| GET · PUT | `/api/settings` | Base currency, fee, spread |
| GET · PUT | `/api/demo/rate-override` | Demo only (`DEMO_MODE=1`): payment-day rate override, labelled `DEMO_OVERRIDE` |
| POST | `/api/demo/quarter-end` | Demo only: trigger quarter-end settle proposals |

---

## Honest limitations

- **Rates:** PayPal's Currency Exchange API isn't provisioned on our sandbox account, so rates come from ECB reference rates (one mid-market rate per day, about 30 currencies) plus the configured spread. The source is stored and shown on every invoice.
- **Demo rate override:** rates barely move during a short demo, so the payment-day rate can be overridden from the demo controls. Every invoice paid under it is stored and shown as `DEMO_OVERRIDE`. There is no seeded or fabricated history; the ledger only contains real sandbox invoices.
- **PDFs:** Groq models don't read PDFs directly, so text is extracted with pypdf first. Scanned PDFs with no text layer are rejected.
- **Sandbox:** invoice emails may not arrive; open the payer link directly while logged in as the sandbox personal account.
- **Database:** SQLite with `create_all`, no migrations; delete `netfirst.db` after a schema change.

---

## Sandbox test harness: `trading_agent.py`

Before building NetFirst we used a small agno + Groq agent to prove the PayPal sandbox setup end to end. It fetches stock data with yfinance, decides an allocation, and sends a PayPal **Payouts** sandbox transfer within hard budget caps, logging every attempt to `audit.log`. It showed that an India business sandbox account is rejected for payouts (`PAYOUT_NOT_AVAILABLE`) while a US account works.

```bash
python -m venv pay && source pay/bin/activate
pip install -r requirements.txt
# .env in the repo root: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_RECEIVER_EMAIL, GROQ_API_KEY
python trading_agent.py
```

---

## License

MIT, see [netfirst/LICENSE](netfirst/LICENSE).
