"use client"

import useSWR from "swr"
import { apiFetch, type Client } from "@/lib/api"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"

export default function ClientsPage() {
  const { data: clients, isLoading } = useSWR<Client[]>("/api/clients", apiFetch, { refreshInterval: 30000 })

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: "var(--font-serif)" }}>Clients</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{clients ? `${clients.length} clients` : "Loading…"}</p>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Currency</TableHead>
              <TableHead className="text-right">Invoiced</TableHead>
              <TableHead className="text-right">FX Balance</TableHead>
              <TableHead className="text-right">FX Cap</TableHead>
              <TableHead>Next Action</TableHead>
              <TableHead className="text-center">Treatments</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: 8 }).map((_, j) => (
                  <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                ))}
              </TableRow>
            ))}
            {!isLoading && (!clients || clients.length === 0) && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8 text-sm">
                  No clients found.
                </TableCell>
              </TableRow>
            )}
            {clients?.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell className="text-muted-foreground">{c.country}</TableCell>
                <TableCell className="text-muted-foreground">{c.currency ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{c.invoiced.display}</TableCell>
                <TableCell className="text-right tabular-nums">{c.fx_balance.display}</TableCell>
                <TableCell className="text-right tabular-nums">{c.cap.display}</TableCell>
                <TableCell>
                  {c.next_action ? (
                    <Badge variant="outline" className="text-xs border-slate-200 text-slate-600 bg-slate-50">
                      {c.next_action.replace(/_/g, " ")}
                    </Badge>
                  ) : "—"}
                </TableCell>
                <TableCell>
                  <div className="flex justify-center gap-1 text-xs text-muted-foreground">
                    <span>C:{c.treatments.CHARGE}</span>
                    <span>T:{c.treatments.TRUE_UP}</span>
                    <span>D:{c.treatments.DEFER}</span>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
