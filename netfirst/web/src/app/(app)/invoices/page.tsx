"use client"

import useSWR from "swr"
import { apiFetch, type Invoice } from "@/lib/api"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { TreatmentBadge, StatusBadge } from "@/components/treatment-badge"

export default function InvoicesPage() {
  const { data: invoices, isLoading } = useSWR<Invoice[]>("/api/invoices", apiFetch, { refreshInterval: 30000 })

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: "var(--font-serif)" }}>Invoices</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{invoices ? `${invoices.length} invoices` : "Loading…"}</p>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Treatment</TableHead>
              <TableHead className="text-right">Source</TableHead>
              <TableHead className="text-right">FX Line</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: 7 }).map((_, j) => (
                  <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                ))}
              </TableRow>
            ))}
            {!isLoading && (!invoices || invoices.length === 0) && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8 text-sm">
                  No invoices yet.
                </TableCell>
              </TableRow>
            )}
            {invoices?.map((inv) => (
              <TableRow key={inv.id}>
                <TableCell className="font-mono text-xs">{inv.invoice_number ?? inv.id.slice(0, 8)}</TableCell>
                <TableCell><StatusBadge value={inv.status} /></TableCell>
                <TableCell><TreatmentBadge value={inv.treatment} /></TableCell>
                <TableCell className="text-right tabular-nums">{inv.source.display}</TableCell>
                <TableCell className="text-right tabular-nums">{inv.fx_line.display}</TableCell>
                <TableCell className="text-right tabular-nums font-medium">{inv.total.display}</TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {new Date(inv.created_at).toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
