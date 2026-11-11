"use client"

import { useRef, useState, useCallback, useEffect } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { TreatmentBadge, StatusBadge } from "@/components/treatment-badge"
import { apiFetch, normaliseRun, type AgentRun, type Draft } from "@/lib/api"

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

function StepTimeline({ steps }: { steps: AgentRun["steps"] }) {
  if (!steps?.length) return null
  return (
    <div className="space-y-2">
      {steps.map((s, i) => (
        <div key={i} className="flex gap-3 text-sm">
          <div className="flex flex-col items-center pt-1">
            <div className="size-2 rounded-full bg-primary shrink-0" />
            {i < steps.length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
          </div>
          <div className="pb-3 min-w-0">
            <span className="font-medium text-xs text-muted-foreground uppercase tracking-wider">{s.tool}</span>
            <p className="text-foreground leading-snug">{s.summary}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function DraftPanel({ draft, runId, onDone }: { draft: Draft; runId: string; onDone: () => void }) {
  const [loading, setLoading] = useState(false)

  const approve = async () => {
    setLoading(true)
    try {
      await apiFetch(`/api/agent/runs/${runId}/approve`, { method: "POST" })
      toast.success("Invoice approved and sent via PayPal")
      onDone()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to approve")
    } finally {
      setLoading(false)
    }
  }

  const rows = [
    { label: "Work",       value: draft.work.display },
    { label: "FX Line",    value: draft.fx_line.display },
    { label: "Discount",   value: draft.discount.display },
    { label: "Deferred",   value: draft.deferred.display },
    { label: "Total",      value: draft.total.display, bold: true },
  ]

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold" style={{ fontFamily: "var(--font-serif)" }}>
            Draft Invoice
          </CardTitle>
          <TreatmentBadge value={draft.treatment} />
        </div>
        <p className="text-xs text-muted-foreground mt-1">{draft.reason}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border divide-y text-sm">
          {rows.map((r) => (
            <div key={r.label} className="flex justify-between px-3 py-2">
              <span className="text-muted-foreground">{r.label}</span>
              <span className={r.bold ? "font-bold" : ""}>{r.value}</span>
            </div>
          ))}
        </div>
        <div className="text-xs text-muted-foreground">
          Rate: <strong>{draft.rate}</strong> &nbsp;·&nbsp; Source: {draft.rate_source}
        </div>
        <Button className="w-full" onClick={approve} disabled={loading}>
          {loading ? "Approving…" : "Approve & Send via PayPal"}
        </Button>
      </CardContent>
    </Card>
  )
}

export default function InvoicePage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [runId, setRunId] = useState<string | null>(null)
  const [run, setRun] = useState<AgentRun | null>(null)
  const [polling, setPolling] = useState(false)
  const [answer, setAnswer] = useState("")
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // On mount: pick up any run that is still active (RUNNING or NEEDS_INPUT)
  useEffect(() => {
    apiFetch<AgentRun[]>("/api/agent/runs").then((runs) => {
      const active = runs.map(normaliseRun).find((r) => r.status === "RUNNING" || r.status === "NEEDS_INPUT" || r.status === "DRAFT_READY")
      if (active) {
        setRunId(active.id)
        setRun(active)
        if (active.status === "RUNNING") startPolling(active.id)
      }
    }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current)
  }

  const startPolling = useCallback((id: string) => {
    setPolling(true)
    pollRef.current = setInterval(async () => {
      try {
        const r = normaliseRun(await apiFetch<AgentRun>(`/api/agent/runs/${id}`))
        setRun(r)
        if (r.status !== "RUNNING") {
          stopPolling()
          setPolling(false)
        }
      } catch { stopPolling(); setPolling(false) }
    }, 1500)
  }, [])

  const upload = async (file: File) => {
    if (!file.type.includes("pdf") && !file.name.endsWith(".pdf")) {
      toast.error("Only PDF invoices are supported")
      return
    }
    const fd = new FormData()
    fd.append("file", file)
    setRun(null)
    setRunId(null)
    try {
      const res = await fetch(`${BASE}/api/agent/runs`, { method: "POST", body: fd })
      if (!res.ok) { const t = await res.text(); throw new Error(t) }
      const data: { id: string } = await res.json()
      setRunId(data.id)
      startPolling(data.run_id)
      toast.info("Agent started — processing invoice")
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Upload failed")
    }
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) upload(f)
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files?.[0]
    if (f) upload(f)
  }, [])

  const sendAnswer = async () => {
    if (!runId || !answer.trim()) return
    try {
      await apiFetch(`/api/agent/runs/${runId}/answer`, {
        method: "POST",
        body: JSON.stringify({ answer: answer.trim() }),
      })
      setAnswer("")
      startPolling(runId)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to send answer")
    }
  }

  const reset = () => {
    stopPolling()
    setRun(null)
    setRunId(null)
    setPolling(false)
    if (fileRef.current) fileRef.current.value = ""
  }

  return (
    <div className="p-6 max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: "var(--font-serif)" }}>New Invoice</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Upload a PDF invoice for agentic FX processing</p>
      </div>

      {!runId && (
        <div
          className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
            dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
          }`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input ref={fileRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={onFileChange} />
          <p className="font-semibold text-sm">Drop a PDF invoice here, or click to browse</p>
          <p className="text-xs text-muted-foreground mt-1">Supported: PDF files up to 20 MB</p>
        </div>
      )}

      {runId && (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Run ID</p>
                <p className="text-sm font-mono">{runId}</p>
              </div>
              <div className="flex items-center gap-2">
                {run && <StatusBadge value={run.status} />}
                {polling && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <span className="size-1.5 rounded-full bg-blue-500 animate-pulse" />
                    Processing
                  </span>
                )}
              </div>
            </div>

            {run?.steps && run.steps.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Agent Steps</p>
                  <StepTimeline steps={run.steps} />
                </div>
              </>
            )}

            {!run && polling && (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            )}

            {run?.status === "NEEDS_INPUT" && run.question && (
              <>
                <Separator />
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Agent Question</p>
                  <p className="text-sm text-muted-foreground">{run.question}</p>
                  <div className="flex gap-2">
                    <Input
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      placeholder="Your answer…"
                      onKeyDown={(e) => e.key === "Enter" && sendAnswer()}
                    />
                    <Button onClick={sendAnswer} disabled={!answer.trim()}>Send</Button>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="space-y-3">
            {run?.draft ? (
              <DraftPanel draft={run.draft} runId={runId} onDone={reset} />
            ) : (
              run?.status !== "RUNNING" && run && (
                <Card>
                  <CardContent className="py-6 text-sm text-center text-muted-foreground">
                    {run.status === "FAILED" ? "Agent run failed." : "No draft generated yet."}
                  </CardContent>
                </Card>
              )
            )}
            <Button variant="outline" size="sm" className="w-full" onClick={reset}>
              Upload another invoice
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
