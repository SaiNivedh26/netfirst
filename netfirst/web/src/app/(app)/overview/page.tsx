"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { ArrowUpRight, FilePlus2 } from "lucide-react"
import { apiFetch, normaliseRun, type AgentRun, type Client, type Summary } from "@/lib/api"
import { TREATMENTS } from "@/lib/treatments"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge } from "@/components/treatment-badge"

function Kpi({ label, value, hint }: { label: string; value?: string; hint: string }) {
  return (
    <div className="rounded-2xl border bg-white p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      {value === undefined ? <Skeleton className="mt-2 h-8 w-32" /> : (
        <p className="mt-1.5 text-[26px] font-bold tabular-nums tracking-tight text-[#0b1f4d]" style={{ fontFamily: "var(--font-serif)" }}>{value}</p>
      )}
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  )
}

export default function OverviewPage() {
  const router = useRouter()
  const { data: summary } = useSWR<Summary>("/api/summary", apiFetch, { refreshInterval: 10000 })
  const { data: clients } = useSWR<Client[]>("/api/clients", apiFetch, { refreshInterval: 10000 })
  const { data: rawRuns } = useSWR<AgentRun[]>("/api/agent/runs", apiFetch, { refreshInterval: 5000 })
  const runs = rawRuns?.map(normaliseRun)

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[#0b1f4d]" style={{ fontFamily: "var(--font-serif)" }}>Overview</h1>
          <p className="mt-1 text-sm text-slate-600">Four clients, four ways the agent handles currency risk.</p>
        </div>
        <Button onClick={() => router.push("/invoice")} className="h-10 rounded-full bg-[#0070ba] px-5 font-semibold hover:bg-[#005ea6]">
          <FilePlus2 className="size-4" /> New invoice
        </Button>
      </div>

      <div data-tour="kpis" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Invoiced this quarter" value={summary?.invoiced_this_quarter.display} hint="Across all currencies, in INR" />
        <Kpi label="Net FX balance" value={summary?.net_fx_balance.display} hint="Positive means clients owe you" />
        <Kpi label="Swings netted" value={summary?.true_ups_netted.display} hint="Gains and losses cancelled out" />
        <Kpi label="Open settlements" value={summary ? String(summary.open_proposals) : undefined} hint="Waiting for your approval" />
      </div>

      <section data-tour="treatments">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">FX treatments</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {TREATMENTS.map((t) => {
            const c = clients?.find((x) => x.name === t.client)
            const Icon = t.icon
            return (
              <Link
                key={t.slug}
                href={`/treatments/${t.slug}`}
                data-tour={`treatment-${t.slug}`}
                className="group relative flex flex-col overflow-hidden rounded-2xl border bg-white p-5 outline-none transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_8px_24px_-12px_rgba(15,23,42,0.25)] focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="absolute inset-x-0 top-0 h-1" style={{ background: t.accent }} />
                <div className="flex items-center justify-between">
                  <span className="grid size-10 place-items-center rounded-xl" style={{ background: t.soft, color: t.accent }}>
                    <Icon className="size-5" />
                  </span>
                  <ArrowUpRight className="size-4 text-slate-300 transition-colors group-hover:text-slate-700" />
                </div>
                <h3 className="mt-4 text-lg font-bold text-slate-900" style={{ fontFamily: "var(--font-serif)" }}>{t.title}</h3>
                <p className="mt-1 text-sm leading-snug text-slate-600">{t.tagline}</p>
                <div className="mt-auto border-t border-slate-100 pt-3" style={{ marginTop: "1rem" }}>
                  <p className="truncate text-xs font-semibold text-slate-800">{t.client}</p>
                  <p className="text-xs tabular-nums text-slate-500">{c ? `Balance ${c.fx_balance.display}` : " "}</p>
                </div>
              </Link>
            )
          })}
        </div>
      </section>

      <section className="rounded-2xl border bg-white">
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-900">Recent agent runs</h2>
          <Link href="/invoice" className="text-xs font-semibold text-[#0070ba] hover:underline">Run the agent</Link>
        </div>
        {!runs ? (
          <div className="space-y-2 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-5 w-full" />)}</div>
        ) : runs.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">No runs yet. Pick a sample invoice to watch the agent work.</p>
        ) : (
          <ul className="divide-y">
            {runs.slice(0, 6).map((r) => (
              <li key={r.id} className="flex items-center gap-4 px-5 py-3">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{r.file_name}</span>
                <span className="hidden text-xs text-slate-500 sm:inline">{r.steps.length} steps</span>
                <StatusBadge value={r.status} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
