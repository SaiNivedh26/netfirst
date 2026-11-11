"use client"

import useSWR from "swr"
import { apiFetch, normaliseRun, type Summary, type AgentRun } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge } from "@/components/treatment-badge"

function KpiCard({ title, value, loading }: { title: string; value?: string; loading: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-widest">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-7 w-32" />
        ) : (
          <p className="text-2xl font-bold tracking-tight" style={{ fontFamily: "var(--font-serif)" }}>{value}</p>
        )}
      </CardContent>
    </Card>
  )
}

export default function DashboardPage() {
  const { data: summary, isLoading: sLoading } = useSWR<Summary>("/api/summary", apiFetch, { refreshInterval: 10000 })
  const { data: rawRuns, isLoading: rLoading } = useSWR<AgentRun[]>("/api/agent/runs", apiFetch, { refreshInterval: 5000 })
  const runs = rawRuns?.map(normaliseRun)

  const kpis = [
    { title: "Invoiced This Quarter", value: summary?.invoiced_this_quarter.display },
    { title: "Net FX Balance",         value: summary?.net_fx_balance.display },
    { title: "True-Ups Netted",         value: summary?.true_ups_netted.display },
    { title: "Open Proposals",          value: summary?.open_proposals != null ? String(summary.open_proposals) : undefined },
  ]

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: "var(--font-serif)" }}>Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">FX invoice intelligence overview</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => (
          <KpiCard key={k.title} title={k.title} value={k.value} loading={sLoading} />
        ))}
      </div>

      <div>
        <h2 className="text-sm font-semibold mb-3">Recent Agent Runs</h2>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Steps</TableHead>
                <TableHead>Question</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rLoading && Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 4 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))}
              {!rLoading && (!runs || runs.length === 0) && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8 text-sm">
                    No runs yet. Upload an invoice to get started.
                  </TableCell>
                </TableRow>
              )}
              {runs?.slice(0, 10).map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="font-medium max-w-[200px] truncate">{run.file_name}</TableCell>
                  <TableCell><StatusBadge value={run.status} /></TableCell>
                  <TableCell className="text-muted-foreground">{run.steps?.length ?? 0}</TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-[260px] truncate">{run.question ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}
