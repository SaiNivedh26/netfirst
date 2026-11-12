"use client"

import useSWR from "swr"
import type { ColDef } from "ag-grid-community"
import { apiFetch, type Client, type Invoice } from "@/lib/api"
import { DataGrid } from "@/components/data-grid"
import { TreatmentBadge, StatusBadge } from "@/components/treatment-badge"

type Row = Invoice & { client: string }

const columns: ColDef<Row>[] = [
  { field: "invoice_number", headerName: "Invoice", minWidth: 110, cellStyle: { fontWeight: 600 } },
  { field: "client", headerName: "Client", minWidth: 160 },
  { field: "description", headerName: "Work", minWidth: 200, flex: 2 },
  { field: "treatment", headerName: "Treatment", cellRenderer: (p: { value: string }) => <TreatmentBadge value={p.value} /> },
  { field: "status", headerName: "Status", cellRenderer: (p: { value: string }) => <StatusBadge value={p.value} /> },
  { headerName: "Total", valueGetter: (p) => p.data?.total.display, type: "rightAligned", cellStyle: { fontWeight: 600 } },
  { headerName: "FX line", valueGetter: (p) => p.data?.fx_line.display, type: "rightAligned" },
  { headerName: "Rate swing", valueGetter: (p) => p.data?.true_up?.display ?? "", type: "rightAligned" },
  { field: "created_at", headerName: "Sent", sort: "desc", valueFormatter: (p) => new Date(p.value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) },
]

export default function InvoicesPage() {
  const { data: invoices, isLoading } = useSWR<Invoice[]>("/api/invoices", apiFetch, { refreshInterval: 30000 })
  const { data: clients } = useSWR<Client[]>("/api/clients", apiFetch)
  const names = new Map(clients?.map((c) => [c.id, c.name]))
  const rows = invoices?.map((i) => ({ ...i, client: names.get(i.client_id) ?? "" }))

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[#0b1f4d]" style={{ fontFamily: "var(--font-serif)" }}>Invoices</h1>
        <p className="mt-1 text-sm text-slate-600">{invoices ? `${invoices.length} invoices across all clients` : "Loading"}</p>
      </div>
      <div className="rounded-2xl border bg-white p-4">
        <DataGrid rows={rows} columns={columns} loading={isLoading} height={560} />
      </div>
    </div>
  )
}
