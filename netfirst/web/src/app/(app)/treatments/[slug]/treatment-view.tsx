"use client"

import { useRouter } from "next/navigation"
import useSWR from "swr"
import type { ColDef } from "ag-grid-community"
import { ArrowRight, FilePlus2, Play } from "lucide-react"
import { apiFetch, type Client, type Invoice, type LedgerRow } from "@/lib/api"
import { TREATMENTS, type TreatmentDef } from "@/lib/treatments"
import { DataGrid } from "@/components/data-grid"
import { ScenarioRunner } from "@/components/scenario/scenario-runner"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const TREATMENT_STYLE: Record<string, [string, string]> = {
  CHARGE: ["#fef3c7", "#b45309"], TRUE_UP: ["#dbeafe", "#1d4ed8"], DEFER: ["#ede9fe", "#6d28d9"],
}

function Pill({ value, styles }: { value: string | null | undefined; styles: Record<string, [string, string]> }) {
  if (!value) return null
  const [bg, fg] = styles[value] ?? ["#f1f5f9", "#475569"]
  return <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: bg, color: fg }}>{value.replace(/_/g, " ")}</span>
}

const STATUS_STYLE: Record<string, [string, string]> = {
  PAID: ["#dcfce7", "#15803d"], SENT: ["#dbeafe", "#1d4ed8"], DRAFT: ["#f1f5f9", "#475569"],
}

const invoiceCols: ColDef<Invoice>[] = [
  { field: "invoice_number", headerName: "Invoice", minWidth: 110, cellStyle: { fontWeight: 600 } },
  { field: "description", headerName: "Work", minWidth: 200, flex: 2 },
  { field: "treatment", headerName: "Treatment", cellRenderer: (p: { value: string }) => <Pill value={p.value} styles={TREATMENT_STYLE} /> },
  { field: "status", headerName: "Status", cellRenderer: (p: { value: string }) => <Pill value={p.value} styles={STATUS_STYLE} /> },
  { headerName: "Amount", valueGetter: (p) => p.data?.source.display, type: "rightAligned" },
  { headerName: "FX line", valueGetter: (p) => p.data?.fx_line.display, type: "rightAligned" },
  { headerName: "Rate swing", valueGetter: (p) => p.data?.true_up?.display ?? "", type: "rightAligned" },
  { field: "created_at", headerName: "Sent", valueFormatter: (p) => new Date(p.value).toLocaleDateString(undefined, { day: "numeric", month: "short" }), sort: "desc" },
]

const LEDGER_STYLE: Record<string, [string, string]> = {
  INVOICE: ["#f1f5f9", "#475569"], PAYMENT: ["#dcfce7", "#15803d"], TRUE_UP: ["#dbeafe", "#1d4ed8"],
  FX_DEFER: ["#ede9fe", "#6d28d9"], SETTLEMENT: ["#d1fae5", "#047857"], CREDIT_APPLIED: ["#fef3c7", "#b45309"],
}

const ledgerCols: ColDef<LedgerRow>[] = [
  { field: "created_at", headerName: "Date", valueFormatter: (p) => new Date(p.value).toLocaleDateString(undefined, { day: "numeric", month: "short" }), sort: "desc" },
  { field: "type", headerName: "Entry", cellRenderer: (p: { value: string }) => <Pill value={p.value} styles={LEDGER_STYLE} /> },
  { field: "invoice_number", headerName: "Invoice" },
  { field: "note", headerName: "Detail", flex: 2, minWidth: 220 },
  {
    headerName: "Amount (base)", valueGetter: (p) => p.data?.amount.display, type: "rightAligned",
    cellStyle: (p) => ({ fontWeight: 600, color: (p.data?.amount.minor ?? 0) < 0 ? "#b91c1c" : "#0f172a" }),
  },
]

export function TreatmentView({ slug }: { slug: string }) {
  const router = useRouter()
  const t = TREATMENTS.find((x) => x.slug === slug) as TreatmentDef
  const { data: clients } = useSWR<Client[]>("/api/clients", apiFetch)
  const { data: invoices, isLoading: invLoading } = useSWR<Invoice[]>("/api/invoices", apiFetch)
  const { data: ledger, isLoading: ledLoading } = useSWR<LedgerRow[]>("/api/ledger", apiFetch)


  const client = clients?.find((c) => c.name === t.client)
  const clientInvoices = client ? invoices?.filter((i) => i.client_id === client.id) : undefined
  const clientLedger = client ? ledger?.filter((e) => e.client_id === client.id && e.type !== "INVOICE" && e.type !== "PAYMENT") : undefined
  const idx = TREATMENTS.findIndex((x) => x.slug === t.slug)
  const next = TREATMENTS[(idx + 1) % TREATMENTS.length]
  const Icon = t.icon

  const usage = client && client.cap.minor > 0 ? Math.max(0, Math.min(100, (client.fx_balance.minor / client.cap.minor) * 100)) : 0

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <section data-tour="treatment-hero" className="relative overflow-hidden rounded-2xl border bg-white p-6">
        <div className="absolute inset-y-0 left-0 w-1" style={{ background: t.accent }} />
        <div className="flex flex-wrap items-start gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-xl" style={{ background: t.soft, color: t.accent }}>
            <Icon className="size-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-3xl font-bold tracking-tight text-[#0b1f4d]" style={{ fontFamily: "var(--font-serif)" }}>{t.title}</h1>
            <p className="mt-1 text-[15px] text-slate-600">{t.tagline}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Button
              data-tour="treatment-run"
              onClick={() => document.querySelector("[data-tour='scenario-runner']")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="h-11 rounded-full px-5 text-sm font-semibold text-white shadow-sm"
              style={{ background: t.accent }}
            >
              <Play className="size-4" /> Run this scenario
            </Button>
            <span className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: t.soft, color: t.accent }}>
              {t.rule}
            </span>
          </div>
        </div>

        <ol data-tour="treatment-flow" className="mt-6 grid gap-3 sm:grid-cols-3">
          {t.steps.map((s, i) => (
            <li key={s} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold text-white" style={{ background: t.accent }}>{i + 1}</span>
              <span className="text-sm font-medium text-slate-800">{s}</span>
            </li>
          ))}
        </ol>
      </section>

      <ScenarioRunner key={t.slug} t={t} />

      <h2 className="pt-2 text-sm font-semibold text-slate-900">Client history</h2>

      <section data-tour="treatment-client" className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
        <div className="rounded-2xl border bg-white p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Client in this story</p>
          {client ? (
            <>
              <div className="mt-2 flex items-baseline justify-between gap-3">
                <h2 className="truncate text-xl font-bold text-slate-900" style={{ fontFamily: "var(--font-serif)" }}>{client.name}</h2>
                <span className="text-sm font-medium text-slate-500">{client.country} · {client.currency}</span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                {(["CHARGE", "TRUE_UP", "DEFER"] as const).map((k) => (
                  <div key={k} className="rounded-lg bg-slate-50 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{k.replace("_", "-")}</p>
                    <p className="text-lg font-bold tabular-nums text-slate-900">{client.treatments[k]}</p>
                  </div>
                ))}
              </div>
            </>
          ) : <Skeleton className="mt-3 h-24 w-full" />}
        </div>

        <div className="rounded-2xl border bg-white p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">FX balance vs cap</p>
          {client ? (
            <>
              <p className={`mt-2 text-2xl font-bold tabular-nums ${client.fx_balance.minor < 0 ? "text-emerald-700" : "text-slate-900"}`} style={{ fontFamily: "var(--font-serif)" }}>
                {client.fx_balance.display}
              </p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full transition-all" style={{ width: `${usage}%`, background: usage >= 100 ? "#dc2626" : t.accent }} />
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {client.fx_balance.minor < 0
                  ? "Credit owed to client, applied on the next invoice"
                  : client.fx_balance.minor >= client.cap.minor
                    ? `Over the ${client.cap.display} cap`
                    : `${usage.toFixed(0)}% of ${client.cap.display} cap`}
              </p>
            </>
          ) : <Skeleton className="mt-3 h-16 w-full" />}
        </div>
      </section>

      <section data-tour="treatment-grid" className="rounded-2xl border bg-white p-4">
        <Tabs defaultValue="invoices">
          <div className="mb-3 flex items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="invoices" className="px-3">Invoices {clientInvoices ? `(${clientInvoices.length})` : ""}</TabsTrigger>
              <TabsTrigger value="ledger" className="px-3">FX ledger {clientLedger ? `(${clientLedger.length})` : ""}</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="invoices">
            <DataGrid rows={clientInvoices} columns={invoiceCols} loading={invLoading} height={330} />
          </TabsContent>
          <TabsContent value="ledger">
            <DataGrid rows={clientLedger} columns={ledgerCols} loading={ledLoading} height={330} />
          </TabsContent>
        </Tabs>
      </section>

      <section data-tour="treatment-next" className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" onClick={() => router.push("/invoice")} className="h-10 rounded-full px-5">
          <FilePlus2 className="size-4" /> Invoice {t.client}
        </Button>
        <Button onClick={() => router.push(`/treatments/${next.slug}`)} className="h-10 rounded-full bg-[#0070ba] px-5 hover:bg-[#005ea6]">
          Next: {next.title} <ArrowRight className="size-4" />
        </Button>
      </section>
    </div>
  )
}
