// NetFirst data fetched from the local FastAPI backend.
// All amounts arrive as { minor: number, currency: string, display: string }.
// We normalise to plain numbers (major units) for AG Grid / AG Studio.

const BASE = process.env.NETFIRST_API_URL ?? 'http://localhost:8000';

async function nf<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`NetFirst ${res.status} on ${path}`);
  return res.json() as Promise<T>;
}

const major = (m: { minor: number; currency: string } | null | undefined): number =>
  m ? m.minor / (m.currency === 'JPY' || m.currency === 'HUF' ? 1 : 100) : 0;

// ── Type stubs (matches FastAPI response shapes) ─────────────────────────────

interface NfMoney { minor: number; currency: string; display: string }

interface NfClient {
  id: string; name: string; email: string; country: string; currency: string | null;
  invoiced: NfMoney; fx_charged: NfMoney; fx_balance: NfMoney; cap: NfMoney;
  next_action: string | null;
  treatments: { CHARGE: number; TRUE_UP: number; DEFER: number };
}

interface NfInvoice {
  id: string; invoice_number: string | null; client_id: string; status: string;
  treatment: string; source: NfMoney; total: NfMoney; fx_line: NfMoney;
  true_up: NfMoney | null; demo_rate: boolean; created_at: string; description: string;
}

interface NfProposal {
  id: string; client_id: string; client: string; amount: NfMoney; status: string;
}

interface NfRun {
  id: string; file_name: string; status: string; question: string | null;
  steps: string; created_at: string;
}

interface NfSummary {
  invoiced_this_quarter: NfMoney; net_fx_balance: NfMoney;
  true_ups_netted: NfMoney; open_proposals: number;
}

// ── Flat rows for AG Studio / AG Grid ────────────────────────────────────────

function clientRows(clients: NfClient[]) {
  return clients.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    country: c.country,
    currency: c.currency ?? 'INR',
    invoicedAmount: major(c.invoiced),
    fxCharged: major(c.fx_charged),
    fxBalance: major(c.fx_balance),
    fxCap: major(c.cap),
    nextAction: c.next_action?.replace(/_/g, ' ') ?? null,
    treatmentCharge: c.treatments.CHARGE,
    treatmentTrueUp: c.treatments.TRUE_UP,
    treatmentDefer: c.treatments.DEFER,
    totalTreatments: c.treatments.CHARGE + c.treatments.TRUE_UP + c.treatments.DEFER,
  }));
}

function invoiceRows(invoices: NfInvoice[]) {
  return invoices.map((i) => ({
    id: i.id,
    invoiceNumber: i.invoice_number ?? i.id.slice(0, 8),
    clientId: i.client_id,
    status: i.status,
    treatment: i.treatment,
    sourceAmount: major(i.source),
    sourceCurrency: i.source.currency,
    total: major(i.total),
    currency: i.total.currency,
    fxLine: major(i.fx_line),
    trueUp: i.true_up ? major(i.true_up) : null,
    demoRate: i.demo_rate,
    createdAt: i.created_at.slice(0, 10),
    description: i.description,
  }));
}

function proposalRows(proposals: NfProposal[]) {
  return proposals.map((p) => ({
    id: p.id,
    clientId: p.client_id,
    clientName: p.client,
    amount: major(p.amount),
    currency: p.amount.currency,
    status: p.status,
  }));
}

function runRows(runs: NfRun[]) {
  return runs.map((r) => {
    let stepCount = 0;
    try { stepCount = JSON.parse(r.steps).length; } catch { /* empty */ }
    return {
      id: r.id,
      fileName: r.file_name,
      status: r.status,
      question: r.question,
      stepCount,
      createdAt: r.created_at.slice(0, 10),
    };
  });
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function getNetFirstData() {
  const [clients, invoices, proposals, runs, summary] = await Promise.allSettled([
    nf<NfClient[]>('/api/clients'),
    nf<NfInvoice[]>('/api/invoices'),
    nf<NfProposal[]>('/api/proposals'),
    nf<NfRun[]>('/api/agent/runs'),
    nf<NfSummary>('/api/summary'),
  ]);

  return {
    nfClients:   clients.status   === 'fulfilled' ? clientRows(clients.value)     : [],
    nfInvoices:  invoices.status  === 'fulfilled' ? invoiceRows(invoices.value)   : [],
    nfProposals: proposals.status === 'fulfilled' ? proposalRows(proposals.value) : [],
    nfRuns:      runs.status      === 'fulfilled' ? runRows(runs.value)           : [],
    nfSummary:   summary.status   === 'fulfilled' ? summary.value                 : null,
  };
}

export type NetFirstData = Awaited<ReturnType<typeof getNetFirstData>>;
