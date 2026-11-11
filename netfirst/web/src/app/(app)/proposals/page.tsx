"use client"

import useSWR from "swr"
import { useState } from "react"
import { toast } from "sonner"
import { apiFetch, type Proposal } from "@/lib/api"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge } from "@/components/treatment-badge"

export default function ProposalsPage() {
  const { data: proposals, isLoading, mutate } = useSWR<Proposal[]>("/api/proposals", apiFetch, { refreshInterval: 15000 })
  const [loading, setLoading] = useState<string | null>(null)

  const settle = async (id: string) => {
    setLoading(id)
    try {
      await apiFetch(`/api/proposals/${id}/approve`, { method: "POST" })
      toast.success("Proposal settled")
      mutate()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to settle")
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: "var(--font-serif)" }}>Proposals</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Pending FX settlement proposals</p>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && Array.from({ length: 3 }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: 4 }).map((_, j) => (
                  <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                ))}
              </TableRow>
            ))}
            {!isLoading && (!proposals || proposals.length === 0) && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8 text-sm">
                  No open proposals.
                </TableCell>
              </TableRow>
            )}
            {proposals?.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.client}</TableCell>
                <TableCell><StatusBadge value={p.status} /></TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{p.amount.display}</TableCell>
                <TableCell className="text-right">
                  {p.status === "PENDING" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => settle(p.id)}
                      disabled={loading === p.id}
                    >
                      {loading === p.id ? "Settling…" : "Settle"}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
