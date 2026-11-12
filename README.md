# NetFirst

**Agentic, currency-agnostic invoicing on PayPal: upload your invoice PDF, get paid what you actually charged.**

Built for *Build What's Next with PayPal and AI* (Devpost, November 2026).

Cross-border PayPal payments quietly lose about 7–9% to the receiving fee and the conversion markup, and freelancers usually guess at a 3–5% buffer to cover it. NetFirst adds the FX cost to the invoice as a visible line, records how the exchange rate actually moved between invoicing and payment, and nets those gains and losses per client, so the leftover settles on one small invoice instead of padding every bill.

---

## Status

| Area | State |
|---|---|
| Invoice agent (PDF to PayPal draft) | Working against the PayPal sandbox and Groq |
| FX engine, ledger, true-up, settlement rules | Built and unit-tested |
| PayPal Invoicing v2 (draft, send, payer link) | Verified in sandbox for GBP, EUR, USD and JPY |
| PayPal Currency Exchange quote | Live: `POST /v2/pricing/quote-exchange-rates`, ECB as silent fallback |
| Paid webhook to true-up | Built and tested; the demo records payment through the same handler |
| Guided demo (four scenarios, driver.js) | Working: each scenario runs a real PDF end to end |
| AG Grid analytics linked to scenarios | Working: the scenario's invoice is pinned in both NetFirst and PayPal grids |
| Isolated demo sessions | Working: every visitor gets their own seeded sandbox |
| Hosted demo | AWS ECS Fargate behind CloudFront |
| Settlement agent, payment follow-up agent, ask-the-ledger | Planned (see [Where the AI goes next](#where-the-ai-goes-next)) |

---

## How it works

1. **Upload** your usual invoice PDF, made in any tool, priced in any currency.
2. **The agent reads it**, validates the fields, matches or creates the client, and asks one question if something essential (like the client's email) is missing.
3. **It prices the invoice** in the client's currency through the FX engine: the work amount plus an "FX and processing" line covering PayPal's fee and conversion spread. The rate comes from PayPal's live Currency Exchange quote API, with ECB reference rates as a fallback.
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

## The demo experience

Everything is served from one origin: `http://localhost:3000` locally, the CloudFront URL when hosted. The web app proxies `/api` to the FastAPI backend and `/analytics` to the AG Grid console, so a visitor never sees another port.

1. **Landing page.** *Start guided demo* creates an isolated session (cookie `nf_session`) and seeds four clients, one per treatment, with history posted through the real ledger rules.
2. **Overview.** Headline FX figures and four scenario cards. A driver.js tour starts on the first visit and can be replayed from *Take the tour* on every page.
3. **Scenario pages** (`/treatments/charge`, `true-up`, `defer`, `settle`). Each explains the rule, then runs it for real in five guided stages:

   | Stage | What happens |
   |---|---|
   | Select invoice | The client's actual PDF is previewed; *Process this invoice* sends it to the agent |
   | Agent processes | Every tool call appears live, including rejected calls and the agent's retry |
   | Review outcome | The chosen treatment and what it does in money terms: FX recovered, credit returned, or FX carried to the balance |
   | Send and collect | The invoice is sent on PayPal; open it as the client or record the payment (same handler as the PayPal paid webhook) |
   | Ledger impact | The exact ledger entries posted and the client's FX balance before and after; Settlement continues into approving the settlement invoice |

   driver.js spotlights the one action that moves each stage forward (*Guide me* turns it off). Starting a scenario first restores that client's seeded history, so the outcome is the same on every run.
4. **Analytics.** *Find it in Analytics* opens the AG Grid console with the scenario's invoice pinned and highlighted, a short tour of the row, a link to the same invoice in the PayPal Invoices grid (read live from the PayPal API), and a link to the next scenario.

### The four scenarios

| Scenario | Client | Invoice | History that drives it | Outcome |
|---|---|---|---|---|
| Charge | Marks & Spencer | GBP 465.82 | 1 paid invoice | `CHARGE`: FX line billed upfront |
| True-Up | Apple Green Ltd | GBP 817.64 | 2 paid, a small credit | `TRUE_UP`: credit applied as a discount, swings netted on payment |
| Defer | Eurotech GmbH | EUR 1,200.00 | 5 paid, under cap | `DEFER`: clean invoice, FX carried to the balance |
| Settlement | Global Freight Co | USD 2,100.00 | 5 paid, balance over cap | `TRUE_UP` (DEFER blocked by the cap), then a settlement proposal to approve |

The PDFs live in `netfirst/api/sample_invoices/` and are generated by `netfirst/api/scripts/make_sample_invoices.py`; each one bills its client by name and email in its own currency.

---

## The AI part

The invoice agent is an [agno](https://github.com/agno-agi/agno) agent running on Groq (`GROQ_MODEL`, default `openai/gpt-oss-120b`). The model reads, decides and explains; deterministic tools do every calculation and every PayPal call.

**What the model decides today**

- **Reads messy PDFs.** Turns unstructured invoice text (odd layouts, tax lines, three-decimal amounts) into structured fields.
- **Knows what's missing.** Asks the user one question when an essential field such as the client email is absent, instead of guessing.
- **Matches or creates the client** from what it read.
- **Chooses the treatment** and writes the reason shown on the PayPal invoice. `get_client_history` returns a `recommended_treatment`: the most generous treatment the guardrails allow for that client's history, which the agent uses unless told otherwise.

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
| Currency Exchange quote | **Primary rate source** — `POST /v2/pricing/quote-exchange-rates` returns a locked rate with `fx_id` and `expiry_time`; ECB reference rates are the fallback and are labelled on the invoice |
| Payouts (stretch) | Paying the net amount when the user owes a client |

---

## Stack

| Layer | Tech |
|---|---|
| Agent | Python 3.13, [agno](https://github.com/agno-agi/agno), Groq |
| API | FastAPI, SQLModel + SQLite, httpx, pypdf, Babel |
| Package manager | [uv](https://docs.astral.sh/uv/) |
| Web UI | Next.js 16 (App Router, Cache Components), shadcn/ui, Tailwind CSS v4, SWR, motion, driver.js, AG Grid |
| Analytics console | AG Grid Community + AG Studio, Next.js 16, driver.js |
| Hosting | Docker, AWS ECR, ECS Fargate, EFS, ALB, CloudFront, Secrets Manager |

```
netfirst/
  .env.example          every tunable, documented (the code has no defaults)
  api/
    app/
      config.py         env access; fails loudly on missing keys
      fx.py             FX engine: the only money arithmetic (Decimal, half-up, minor units)
      rates.py          PayPal FX quote (primary) → ECB fallback → demo override
      paypal.py         OAuth, Invoicing v2 payloads, webhook verification
      ledger.py         posting rules, guardrails, settle proposals, paid handler
      agent.py          agno + Groq invoice agent and its tools
      models.py         tables
      main.py           FastAPI routes
      scripts/seed.py   per-scenario seeders and the scenario reset
    sample_invoices/    the four scenario PDFs and their manifest
    scripts/smoke.py    sandbox smoke test
    scripts/make_sample_invoices.py   regenerates the scenario PDFs
    tests/              pytest suite
    Dockerfile, entrypoint.sh
  web/                  Next.js UI
    src/app/page.tsx                 landing page
    src/app/(app)/overview           overview and its tour
    src/app/(app)/treatments/[slug]  scenario pages
    src/components/scenario/         guided runner and driver.js spotlight hook
    src/components/tour/             page tours
    next.config.ts                   /api and /analytics proxies
    Dockerfile

hackathon-paypal-ag-grid-boilerplate/
  lib/netfirst-data.ts  fetches NetFirst API, normalises to AG Grid rows
  lib/dashboard-data.ts merges PayPal + NetFirst data for AG Studio
  app/dashboard/studio/ AG Studio data sources, relationships, FX Intelligence report
  app/(endpoints)/      per-entity AG Grid pages (invoices, clients, proposals)
  app/(endpoints)/scenario-guide.tsx  pins and tours the row a scenario links to
  Dockerfile

scripts/                AWS: push-secrets, infra-setup, build-push, deploy
```

Amounts are integers in each currency's minor units (JPY 0 decimals, KWD 3); balances are always derived from an append-only ledger.

---

## Setup

### 1. PayPal sandbox

At [developer.paypal.com](https://developer.paypal.com), with **Sandbox** selected:

1. **Testing Tools → Sandbox Accounts → Create account**: a **Business** account in the **United States** (India business sandbox accounts are restricted for Payouts).
2. **Create account** again: a **Personal** account in the **United Kingdom** (the paying client). Note its email and password from *View/edit account*.
3. **Apps & Credentials → Create App**: type **Merchant**, linked to the US business account, with **Invoicing** enabled under Features. Copy the Client ID and Secret.
4. **Activate Multi-currency service** on the sandbox business account (Business Tools → Streamline Operations) to enable the PayPal Currency Exchange quote API.

### 2. Groq

Create an API key at [console.groq.com](https://console.groq.com).

### 3. Configure

```bash
cp netfirst/.env.example netfirst/.env
# fill PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, GROQ_API_KEY, SMOKE_RECIPIENT_EMAIL
```

Every other value in `.env.example` is a documented default you can change: fees, spread, guardrail thresholds, client caps, model, timeouts, rate source URL, payment term.

### 4. API server

```bash
cd netfirst/api
uv sync
uv run pytest                       # unit + DB-backed tests, no network
uv run python -m scripts.smoke      # checks sandbox: OAuth, drafts, send, payer link
uv run uvicorn app.main:app --port 8000
```

Set `DEMO_MODE=1` in `.env` for the guided demo (sessions, scenario reset, recorded payments).

### 5. AG Grid console

```bash
cd hackathon-paypal-ag-grid-boilerplate
npm install
# .env.local: AG Studio licence key, PAYPAL_CLIENT_ID/SECRET, NETFIRST_API_URL=http://localhost:8000
npm run dev -- --port 3001
```

### 6. Web UI (the entry point)

```bash
cd netfirst/web
npm install
npm run dev                         # http://localhost:3000
```

Open **http://localhost:3000** only. It proxies `/api/*` to `API_URL` (default `http://localhost:8000`) and `/analytics/*` to `ANALYTICS_URL` (default `http://localhost:3001`), so all three services share one origin and one session cookie.

To regenerate the scenario PDFs after editing them:

```bash
cd netfirst/api
uv run --with reportlab python scripts/make_sample_invoices.py
```

### 7. Webhooks (optional locally)

PayPal needs a public HTTPS URL:

```bash
ngrok http 8000
```

Add a sandbox webhook on your app for `https://<tunnel>/api/webhooks/paypal` with the *Invoice paid* and *Invoice cancelled* events, and put its ID in `PAYPAL_WEBHOOK_ID`. Without a webhook, `POST /api/invoices/{id}/sync` reads the status from PayPal and posts the payment and true-up the same way.

---

## Deploy to AWS

### Architecture

```
Browser ── HTTPS ── CloudFront ── HTTP ── Application Load Balancer
                                           ├─ /api/*       → backend  :8000  (FastAPI)
                                           ├─ /analytics*  → aggrid   :3001  (AG Grid console)
                                           └─ /*           → web      :3000  (Next.js)
ECS Fargate service netfirst-demo: one task, three containers
EFS mounted at /data in the backend  → SQLite at /data/netfirst.db survives redeploys
Secrets Manager netfirst/api, netfirst/aggrid → injected as container env vars
CloudWatch Logs /ecs/netfirst
```

Inside the task the containers share `localhost`, so the AG Grid console reaches the backend at `http://localhost:8000` with no extra configuration.

### Prerequisites

- AWS CLI v2 with a profile that can manage ECR, ECS, EFS, ELB, CloudFront, IAM and Secrets Manager (the scripts use profile `sai-nivedh-26` in `us-east-1`; edit the variables at the top of each script for another account).
- Docker, with a few GB of free disk (`docker system prune -f` clears old layers).
- `netfirst/.env` and `hackathon-paypal-ag-grid-boilerplate/.env.local` filled in as for local setup.

### First deployment

```bash
bash scripts/push-secrets.sh    # .env files → Secrets Manager (values are never printed)
bash scripts/infra-setup.sh     # ECR, EFS, IAM role, security groups, target groups, ALB, ECS, CloudFront
bash scripts/build-push.sh      # build the three images and push :latest to ECR
bash scripts/deploy.sh          # register the task definition and start the service
```

`infra-setup.sh` is idempotent and writes resource IDs to `scripts/.infra-outputs`, which the other scripts read. The site is served at the `CF_DOMAIN` in that file.

### Shipping a change

When only code changed, rebuild the images and restart the service on the current task definition:

```bash
bash scripts/build-push.sh
aws ecs update-service --cluster netfirst-demo --service netfirst-demo --force-new-deployment \
  --deployment-configuration "maximumPercent=200,minimumHealthyPercent=0" \
  --region us-east-1 --profile sai-nivedh-26
aws ecs wait services-stable --cluster netfirst-demo --services netfirst-demo --region us-east-1 --profile sai-nivedh-26
```

Run `deploy.sh` only when the task definition itself changes (secrets, environment, CPU or memory).

### Troubleshooting

| Symptom | Cause and fix |
|---|---|
| 503 from CloudFront | No healthy task. `minimumHealthyPercent=0` in the command above lets a stalled deployment replace the task immediately; check `describe-services` for `runningCount` |
| Backend exits with `uvicorn: not found` | The EFS volume was mounted over `/app`; it must be `/data` with `DATABASE_URL=sqlite:////data/netfirst.db` |
| Image build fails with no space left | `docker system prune -f && docker builder prune -f` |
| Analytics shows another visitor's data | The console must forward the `cookie` header to the backend; see `lib/netfirst-data.ts` |
| PayPal Invoices grid slow or times out | It fetches every sandbox invoice in detail; requests run 8 at a time with retries |

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
| GET | `/api/invoices` | All invoices with FX lines |
| GET | `/api/summary` | Summary figures |
| GET | `/api/proposals` | Open settle proposals |
| POST | `/api/proposals/{id}/approve` · `/dismiss` | Act on a proposal |
| POST | `/api/webhooks/paypal` | Verified PayPal webhook |
| POST | `/api/invoices/{id}/sync` | Pull paid status from PayPal (webhook fallback) |
| GET · PUT | `/api/settings` | Base currency, fee, spread |
| GET · PUT | `/api/demo/rate-override` | Demo only (`DEMO_MODE=1`): payment-day rate override, labelled `DEMO_OVERRIDE` |
| POST | `/api/demo/quarter-end` | Demo only: trigger quarter-end settle proposals |
| GET | `/api/ledger` | Ledger entries with client, invoice and treatment |
| POST | `/api/demo/session` | Create an isolated demo session and seed its four clients |
| POST | `/api/demo/reset` | Wipe and re-seed the current session |
| POST | `/api/demo/scenario/{slug}/reset` | Restore one scenario's client to its seeded history |
| POST | `/api/demo/simulate-payment/{invoice_id}` | Record a payment through the paid-webhook handler |
| GET | `/api/sample-invoices` · `/{id}/file` | Scenario PDFs and their manifest |

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
