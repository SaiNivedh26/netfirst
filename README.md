# NetFirst

**Agentic FX management for cross-border payments. Upload invoice → agent prices it → you approve → payment settles with real rates.**

NetFirst turns PayPal's Invoicing API into an intelligent bookkeeping partner. A Groq-powered agent reads your invoice PDFs, matches clients, fetches live FX rates, and calculates what your customer actually pays—covering PayPal's fee and conversion markup transparently. Choose how to handle future rate swings (charge now, true-up later, or defer), and NetFirst nets gains and losses per client, settling on one small invoice instead of padding every bill.

---

## How It Works

```
┌─────────────────┐      ┌──────────────────────────────┐      ┌──────────────────────────────┐
│  Upload Invoice │─────→│ Agent reads & validates      │─────→│ FX engine prices invoice in  │
│                 │      │ fields, matches new client   │      │ client's currency, adds FX   │
│                 │      │ follow up for missing info   │      │ & processing via PayPal API  │
└─────────────────┘      └──────────────────────────────┘      └──────────────────────────────┘
                                                                          ↓
                                                          ┌───────────────────────────────┐
                                                          │ Select risk procedure for     │
                                                          │ future rate swings and        │
                                                          │ generate reasoning for        │
                                                          │ clients                       │
                                                          └───────────────────────────────┘
                                                                          ↓
┌──────────────────────────┐      ┌────────────────────────────────────────────────────────────┐
│ Create a PayPal draft,   │←─────│ Select risk procedure for future rate swings and generate  │
│ after manual approval    │      │ reasoning for clients                                      │
└──────────────────────────┘      └────────────────────────────────────────────────────────────┘
         ↓
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Payment & settle; records payment-day fx-gain/loss to running balance.           │
│ Settle balance on future invoices or in batch when over cap or at quarter-end    │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## Features

- **Agentic invoice processing** — PDF → structured fields → PayPal draft in minutes
- **Live FX rates** — PayPal Currency Exchange quote API with ECB fallback
- **Three risk treatments** — CHARGE (upfront), TRUE_UP (swing netted on payment), DEFER (balance carried)
- **Per-client FX ledger** — gains and losses tracked separately, settled in batch
- **Interactive demo** — four real scenarios: Charge, True-Up, Defer, Settlement
- **PayPal sandbox verified** — GBP, EUR, USD, JPY tested across multiple clients

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Agent | Python 3.13, [agno](https://github.com/agno-agi/agno), Groq |
| API | FastAPI, SQLModel, SQLite |
| Web UI | Next.js 16, shadcn/ui, Tailwind, driver.js |
| Analytics | AG Grid, Next.js 16 |
| Hosting | Docker, AWS ECS Fargate, CloudFront |

---

## Quick Start

### 1. PayPal Sandbox

At [developer.paypal.com](https://developer.paypal.com) with **Sandbox** selected:

1. Create a **Business** account (United States)
2. Create a **Personal** account (United Kingdom)
3. Create an **Invoicing**-enabled app and copy credentials
4. Enable Multi-Currency on your business account

### 2. Groq API

Get a key at [console.groq.com](https://console.groq.com).

### 3. Configure & Run

```bash
cp netfirst/.env.example netfirst/.env
# Fill PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, GROQ_API_KEY

# Backend
cd netfirst/api && uv sync && uv run uvicorn app.main:app --port 8000 &

# Web UI (http://localhost:3000)
cd netfirst/web && npm install && npm run dev
```

Open http://localhost:3000, start the demo, upload an invoice PDF.

---

## API

### Agent

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/agent/runs` | Upload PDF; start agent |
| GET | `/api/agent/runs/{id}` | Status, trace, draft |
| POST | `/api/agent/runs/{id}/approve` | Send invoice and post ledger |

### Ledger

| Method | Path |
|--------|------|
| GET | `/api/clients` |
| GET | `/api/ledger` |
| GET | `/api/invoices` |
| POST | `/api/proposals/{id}/approve` |

Full API docs at `http://localhost:8000/docs`.

---

## Deploy to AWS

```bash
bash scripts/push-secrets.sh    # Upload .env to Secrets Manager
bash scripts/infra-setup.sh     # Create ECS, EFS, ALB, CloudFront
bash scripts/build-push.sh      # Build and push images
bash scripts/deploy.sh          # Deploy to ECS
```

Site is live at the CloudFront domain in `scripts/.infra-outputs`.

---

## License

MIT. See [netfirst/LICENSE](netfirst/LICENSE).
