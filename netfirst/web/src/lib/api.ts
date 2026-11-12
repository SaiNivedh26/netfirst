const BASE = process.env.NEXT_PUBLIC_API_URL ?? ""

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    ...init,
    headers: init?.body instanceof FormData ? undefined : { "Content-Type": "application/json", ...init?.headers },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(text || res.statusText)
  }
  return res.json() as Promise<T>
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface Money { minor: number; currency: string; display: string }

export interface Summary {
  invoiced_this_quarter: Money
  net_fx_balance: Money
  true_ups_netted: Money
  open_proposals: number
}

export interface Client {
  id: string
  name: string
  email: string
  country: string
  currency: string | null
  invoiced: Money
  fx_charged: Money
  fx_balance: Money
  cap: Money
  last_swing: Money | null
  treatments: { CHARGE: number; TRUE_UP: number; DEFER: number }
  next_action: "SETTLE" | "CREDIT_ON_NEXT_INVOICE" | null
}

export interface Draft {
  invoice_id: string
  paypal_invoice_id: string
  paypal_url: string | null
  status: string
  currency: string
  work: Money
  fx_line: Money
  discount: Money
  total: Money
  deferred: Money
  treatment: "CHARGE" | "TRUE_UP" | "DEFER"
  reason: string
  rate: string
  rate_source: string
}

export interface AgentRun {
  id: string
  file_name: string
  status: "RUNNING" | "DRAFT_READY" | "NEEDS_INPUT" | "FAILED" | "SENT"
  question: string | null
  extracted: Record<string, unknown> | null
  // The API returns steps as a JSON string from the DB; normalise it here.
  steps: Array<{ tool: string; summary: string; ms?: number; at_s?: number; args?: Record<string, unknown> }>
  draft: Draft | null
}

export function normaliseRun(r: AgentRun): AgentRun {
  return { ...r, steps: typeof r.steps === "string" ? JSON.parse(r.steps as unknown as string) : r.steps ?? [] }
}

export interface Invoice {
  id: string
  invoice_number: string | null
  client_id: string
  status: string
  treatment: "CHARGE" | "TRUE_UP" | "DEFER"
  source: Money
  total: Money
  fx_line: Money
  true_up: Money | null
  rate_source: string | null
  demo_rate: boolean
  created_at: string
  description: string
}

export interface Proposal {
  id: string
  client_id: string
  client: string
  amount: Money
  status: string
  reason: string
}

export interface LedgerRow {
  id: string
  client_id: string
  invoice_id: string | null
  client: string | null
  type: "INVOICE" | "PAYMENT" | "TRUE_UP" | "FX_DEFER" | "SETTLEMENT" | "CREDIT_APPLIED"
  note: string
  created_at: string
  amount: Money
  invoice_number: string | null
  treatment: "CHARGE" | "TRUE_UP" | "DEFER" | null
}

export interface SampleInvoice {
  id: string
  label: string
  description: string
  client: string
  currency: string
  amount: string
}
