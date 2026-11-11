# NetFirst

**Agentic, currency-agnostic invoicing on PayPal: upload your invoice, get paid what you actually charged.**

Built for *Build What's Next with PayPal and AI* (Devpost, November 2026).

---

## 1. One-line pitch

NetFirst adds FX costs transparently and nets what the market actually moved, so neither you nor your client pays more than the exchange rate really changed.

## 2. The problem

Freelancers and small businesses who bill clients abroad through PayPal rarely receive what they invoiced.

- **Hidden costs.** A cross-border PayPal payment typically loses about 7–9% between what the client pays and what lands: a receiving fee of roughly 4.4% plus a fixed fee, and a conversion rate about 3–4% worse than the mid-market rate.
- **Invisible losses.** The conversion markup sits inside the exchange rate, so most people never see it. Freelancers have found they lost up to 12% on small invoices.
- **No timing control in some countries.** In India, for example, RBI rules force immediate conversion to INR, so users cannot hold foreign currency and convert later.
- **Guesswork pricing.** The usual advice is to pad invoices with a 3–5% buffer in case the rate moves before the client pays. That means clients often overpay, while freelancers still lose on bad days.
- **Manual work.** People convert prices by hand, retype invoices in another currency, and track rate differences in spreadsheets, if at all.

> Figures are approximate, from published fee guides and community discussions. Check PayPal's current fee pages before quoting them.

## 3. The solution

NetFirst sits between the user's normal invoicing and PayPal.

1. **Upload your usual invoice PDF**, made in any tool and priced in any currency.
2. **An AI agent reads it**, matches the client, gets a live exchange rate, and calculates the FX cost.
3. **It drafts a PayPal invoice** in the output currency you pick, with the FX cost shown as a clear line, never hidden.
4. **It decides how to handle future rate swings** for that client and explains why.
5. **You approve with one click**, and the client receives a normal PayPal invoice.
6. **When the client pays**, NetFirst records the real payment-day rate, puts any gain or loss on that client's running FX balance, and later settles the small leftover on a single invoice.

The result: you take home what you charged, the client is never padded, and every adjustment is visible to both sides.

## 4. Currency model

NetFirst is currency-agnostic. Up to three currencies can be involved in one invoice, and every stored amount is labelled with one of them.

| Currency | What it is | Where it comes from |
| --- | --- | --- |
| **Source** | The currency the work was priced in | Read from the PDF (ISO code, symbol, or wording). The agent asks if a symbol such as `$` is ambiguous. |
| **Output** | The currency the client is invoiced in and pays | Chosen by the user. The agent pre-selects the client's usual currency. Must be a PayPal-supported invoicing currency. |
| **Base** | The user's bookkeeping currency for the ledger and balances | Set once in settings (INR, EUR, USD, or any other). |

Rules:

- Rates are fetched for any pair: PayPal's Currency Exchange quote when available, otherwise ECB cross rates through EUR.
- Minor units follow each currency's exponent (JPY has 0 decimals, most currencies 2, KWD 3).
- The FX line always covers PayPal's receiving fee, and adds the conversion spread only when output differs from base.
- Changing the output currency on a draft re-prices it instantly; nothing is sent until approval.
- True-ups and balances are measured in base currency, so clients paying in different currencies share one ledger.
- If source, output and base are all the same, NetFirst adds no FX line and tracks no swing.

## 5. Three treatments per invoice

Each invoice has two separate FX components: the **cost** (PayPal fee plus conversion spread) and the **rate swing** between the day the invoice is issued and the day it is paid. The agent picks one of three treatments for where each goes.

| Treatment | FX cost (FX line) | Rate swing before payment | Best for |
| --- | --- | --- | --- |
| **CHARGE** | Shown on the invoice | Absorbed by the user, not tracked | One-off or slow-paying clients |
| **TRUE_UP** | Shown on the invoice | Posted to the client's running balance | Repeat clients |
| **DEFER** | Posted to the balance | Posted to the balance | Loyal clients, within a balance cap |

## 6. Netting: the core idea

Large companies have long reduced FX costs through *netting*: settling only the difference between what parties owe each other. NetFirst brings that idea to freelancers and small businesses in three ways.

### Netting across time (works with any repeat client)

Instead of padding every invoice with a buffer, NetFirst invoices at today's rate. When the client pays, it compares the invoice-day and payment-day rates and posts the difference to that client's balance. Because exchange rates move both up and down, gains and losses largely cancel out over time. Only the leftover is settled:

- at quarter end,
- when the balance crosses a cap, or
- after 90 days, whichever comes first.

If the user owes the client (a negative balance), PayPal invoices cannot be negative, so the credit is applied as a discount on the next invoice.

### Batching

Several small invoices to the same client in a month can be rolled into one PayPal invoice, saving fixed fees and conversions.

### Netting across directions (bonus)

If a client also bills the user (for example, two agencies that subcontract to each other), only the net difference needs to move, so far less money is converted.

## 7. Worked example

INR base, GBP client, illustrative rates (fee 4.4%, spread 3.5%, so the receiver keeps 92.25%).

| Step | Calculation | Result |
| --- | --- | --- |
| Price read from the PDF | — | ₹44,000 |
| Output base at £1 = ₹110 | 44,000 ÷ 110 | £400.00 |
| FX line | 400 ÷ 0.9225 − 400 | £33.60 |
| Invoice total | 400.00 + 33.60 | **£433.60** |
| March invoice paid at ₹107 (TRUE_UP) | 44,000 − 400 × 107 | Client owes ₹1,200 |
| April invoice paid at ₹112 (TRUE_UP) | 44,000 − 400 × 112 | Client credited ₹800 |
| Quarter end | 1,200 − 800 | **₹400** settled on one invoice |

Without NetFirst, padding both invoices by 3–5% would have overcharged the client about ₹2,600–₹4,400, or the freelancer would have absorbed the ₹1,200 March loss. With NetFirst, the client pays only the ₹400 the market actually moved.

## 8. The invoice agent

The agent is the heart of the product. It is a Claude tool-calling loop (via the Vercel AI SDK) that turns a PDF into a ready-to-approve PayPal draft. The agent reads, plans, chooses and explains; deterministic tools do every calculation and every PayPal call; a human approves before anything is sent.

### What happens in one run

1. Read the PDF and extract the client, line items, amounts, source currency, invoice number and due date.
2. Validate the extraction (items sum to the total, valid currency codes and dates).
3. Match the client, or propose a new one for the user to confirm.
4. Pull the client's history and fetch rate quotes (source to output, output to base).
5. Price the invoice through the FX engine, applying any credit from a negative balance.
6. Choose a treatment and confirm it against the guardrails.
7. Create a PayPal **draft** invoice and show it with a step-by-step trace.
8. The user can change the output currency or treatment, then clicks **Approve and send**.

### Agent tools

| Tool | Purpose |
| --- | --- |
| `validate_extraction` | Check sums, dates, currency codes and email format |
| `find_client` / `propose_client` | Match an existing client or draft a new one |
| `get_client_history` | Paid invoices, average days to pay, balance, cap, credit |
| `get_fx_quote` | Rate for any currency pair |
| `price_invoice` | Output base, FX line, total and discount for a treatment |
| `check_policy` | Confirm a treatment or return the allowed downgrade |
| `create_paypal_draft` | Create a PayPal draft invoice (never sends) |
| `ask_user` | Pause the run with one question when something essential is missing |

### Guardrails

- Sending is not an agent tool; only the user's approval sends an invoice.
- The server checks that draft amounts match the FX engine's output before calling PayPal.
- New clients (fewer than two paid invoices) always get CHARGE.
- DEFER requires at least three paid invoices and a balance under the cap.
- If extraction fails validation twice, the agent asks instead of guessing.
- On timeout or model error, the user gets the partial trace and a pre-filled manual form.
- Every run, step and user override is logged.

### Supporting AI features

- **Settlement and batch proposals:** the system detects when a balance should be settled or invoices batched; the AI writes the reason for the user and a plain-language note for the client.
- **Ask the ledger:** questions like *"Which clients cost me most in FX this year?"* return an answer and filters that the AG Grid ledger applies live.

## 9. User experience

A single-page web app:

- **Summary cards:** invoiced this quarter, net FX balance, savings compared with padding.
- **Upload panel:** drop a PDF and watch the agent's trace animate step by step. Review extracted fields (low-confidence ones highlighted) and the draft invoice (work, FX line, total, treatment, reason), with an output-currency selector that re-prices instantly. Then approve and send.
- **Proposals panel:** settle and batch suggestions with one-click approval.
- **Ask bar:** plain-English questions that filter the ledger.
- **AG Grid client ledger:** one row per client (currency, invoiced, FX charged, running FX balance, next action). Expand a row to see every invoice: source and output amounts, FX line, treatment, rate invoiced vs. rate paid, true-up, status and PayPal link.

**What the client sees:** a normal PayPal invoice listing, for example, "Brand kit £400.00" and "FX and processing £33.60", with the rate and date used, or a note about a carried balance. The client needs no NetFirst account.

## 10. How PayPal is used

| PayPal capability | Role in NetFirst |
| --- | --- |
| **Invoicing v2** | Create drafts with the FX line, send invoices, apply discounts for credits, send settlement and batch invoices |
| **Currency Exchange quote API** | Retail rate quotes (wholesale rate plus conversion fee), with ECB as fallback |
| **Webhooks** | `INVOICING.INVOICE.PAID` triggers the payment-day true-up |
| **PayPal Agent Toolkit** (where it fits) | Invoice tools for the agent |
| **Payouts** (stretch) | Paying the net amount when the user owes a client in the two-way case |

PayPal is not interchangeable here: invoicing, rate quotes and payment events are the backbone of every flow.

## 11. Architecture

```
            ┌──────────────────────────┐
            │  Web console              │
            │  React + AG Grid          │
            └────────────┬─────────────┘
                         │ REST
┌────────────────────────┴─────────────────────────┐
│  NetFirst API (Fastify + TypeScript)              │
│                                                   │
│  Invoice agent ──► tools ──► FX engine            │
│        │                         │                │
│        ▼                         ▼                │
│  Invoice & settlement service   Ledger (Prisma)   │
└───────┬──────────────┬───────────────┬───────────┘
        │              │               │
        ▼              ▼               ▼
  PayPal sandbox    ECB rates       Claude API
  (Invoicing,       (fallback,      (Vercel AI SDK)
   Currency Exch.,   history)
   Webhooks)
```

| Layer | Choice |
| --- | --- |
| Language | TypeScript (pnpm workspace) |
| API | Fastify, zod validation, @fastify/multipart for PDF upload |
| Database | Prisma + SQLite (Postgres optional) |
| Money maths | decimal.js, integers in minor units |
| AI | Vercel AI SDK with Claude: tool-calling agent plus structured single calls |
| Frontend | React + Vite + AG Grid (master/detail) |
| Hosting | Render |

## 12. Data model (summary)

| Table | Holds |
| --- | --- |
| **Client** | Name, email, country, preferred output currency, balance cap, settle-by days |
| **Invoice** | Source amount and currency, output currency and amount, FX line, treatment and AI reason, rate invoiced and paid, status, PayPal IDs, source PDF, agent run |
| **LedgerEntry** | Append-only money events in base currency: INVOICE, PAYMENT, TRUE_UP, FX_DEFER, SETTLEMENT, CREDIT_APPLIED |
| **Proposal** | Open settle and batch suggestions |
| **Settings** | Base currency, fee and spread defaults |
| **AgentRun** | Status, extracted fields, step trace, question asked |
| **WebhookEvent** | Processed PayPal event IDs (de-duplication) |
| **AiDecision** | Every AI input, output and user override |

Balances are always derived from the ledger, never stored as a single number.

## 13. Key formulas

All amounts in minor units; `fee` = PayPal receiving fee, `spread` = conversion spread.

```
outputBase   = convert(sourceAmount, source → output)
gross        = outputBase / ((1 − fee) × (1 − spread))     // spread only if output ≠ base
fxLine       = gross − outputBase
trueUpBase   = outputBase × rateInvoiced(output → base) − outputBase × ratePaid(output → base)
balance      = Σ TRUE_UP + FX_DEFER + SETTLEMENT + CREDIT_APPLIED
settlement   = grossUp(convert(balance, base → output))
```

A positive true-up means the client owes the user; a negative one is a credit.

## 14. Demo (under 3 minutes)

1. **The problem:** an invoice to a client abroad quietly loses 7–9%.
2. **The agent:** drop a PDF; the trace animates through extraction, client match, rate quote, pricing, treatment choice and PayPal draft. Switch the output currency from GBP to EUR to show instant re-pricing, then approve and send.
3. **Payment:** pay as the client in the PayPal sandbox; the webhook posts a true-up.
4. **Netting:** expand the client in AG Grid; an earlier gain offsets most of the loss. Approve the settlement, and one small PayPal invoice settles the net.
5. **Ask the ledger:** "Which clients cost me most in FX?" The grid filters itself.

Rates barely move during a video, so seeded history uses real ECB historical rates, and the live payment uses a clearly labelled demo rate override.

## 15. Hackathon prize alignment

| Prize | Why NetFirst fits |
| --- | --- |
| **Best Use of PayPal + AI** (primary) | An AI agent drives PayPal Invoicing, rate quotes and webhooks end to end; PayPal is not swappable |
| **Best Use of AG Grid** | The client ledger with master/detail and AI-driven filters is central to the product |
| **Most Creative** | Brings corporate-style netting to freelancers, across time as well as direction |
| **Most Impactful** | Addresses a 7–9% hidden cost on every cross-border invoice for millions of freelancers |
| **Best Demo Delivery** | A clear before-and-after: PDF in, honest invoice out, netting visible in the ledger |

## 16. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Currency Exchange quote unavailable in sandbox | ECB rate plus configured spread, labelled "estimated" |
| Sandbox account cannot invoice in some currencies | Use a business sandbox account in a supported country; document the limitation |
| PDF extraction errors | Validation tool, `ask_user`, highlighted low-confidence fields, manual fallback |
| Agent latency or loops | Step cap, timeout, live trace |
| Clients dislike a carried balance | Always shown on the invoice, capped, settled within 90 days |
| Judges question the demo rate override | Real historical data for seeding; override labelled in the UI and README |
| Regulatory questions (e.g. cross-border set-off rules, tax on FX lines) | Out of scope for the MVP; two-way netting needs both parties' agreement |

## 17. Future work

- Two-way netting with Payouts and multilateral netting across several partners
- Compliance add-ons, such as matching payments to India's e-FIRA documents and purpose codes
- Smart local-currency pricing suggestions per market
- Shared client portal showing the running FX balance
- Rate alerts that suggest the best settlement date

## 18. Sources

- [PayPal fees in 2026 (Checkoutpage)](https://checkoutpage.com/blog/paypal-fees)
- [PayPal India review for freelancers (Karbon)](https://www.karboncard.com/blog/paypal-india-review-freelancer-fees)
- [The real cost of PayPal for Indian freelancers (Winvesta)](https://www.winvesta.in/blog/businesses/the-real-cost-of-paypal-for-indian-freelancers-in-2026)
- [Freelancing for international clients (Wise)](https://wise.com/us/blog/save-money-while-freelancing-for-international-clients)
- [How to invoice international clients (InvoiceBloom)](https://invoicebloom.io/blog/how-to-invoice-international-clients)
- [PayPal Currency Exchange API reference](https://developer.paypal.com/docs/api/pricing/v2)
- [PayPal REST API docs](https://developer.paypal.com/api/rest/)
