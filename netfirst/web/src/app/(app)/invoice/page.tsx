"use client"

import { useRef, useState, useCallback, useEffect } from "react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { TreatmentBadge, StatusBadge } from "@/components/treatment-badge"
import { apiFetch, normaliseRun, type AgentRun, type Draft } from "@/lib/api"
import { TREATMENTS } from "@/lib/treatments"
import { Loader2, Play, Upload } from "lucide-react"

const BASE = process.env.NEXT_PUBLIC_API_URL ?? ""

interface SampleInvoice {
  id: string
  label: string
  description: string
  client: string
  currency: string
  amount: string
}

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

function DraftPanel({ draft: initialDraft, runId, onDone }: { draft: Draft; runId: string; onDone: () => void }) {
  const [loading, setLoading] = useState(false)
  const [simulating, setSimulating] = useState(false)
  const [draft, setDraft] = useState(initialDraft)
  const router = useRouter()

  const simulatePayment = async () => {
    setSimulating(true)
    try {
      await apiFetch(`/api/demo/simulate-payment/${draft.invoice_id}`, { method: "POST", credentials: "include" } as RequestInit)
      toast.success("Payment completed — invoice marked PAID.")
      onDone()
      router.push("/invoices")
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Payment failed")
    } finally {
      setSimulating(false)
    }
  }

  const approve = async () => {
    setLoading(true)
    try {
      await apiFetch(`/api/agent/runs/${runId}/approve`, { method: "POST" })
      // Re-fetch run to get SENT status + paypal_url
      const updated = await apiFetch<{ draft: Draft }>(`/api/agent/runs/${runId}`)
      if (updated.draft) setDraft(updated.draft)
      toast.success("Invoice sent via PayPal — open the link below to pay")
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to approve")
    } finally {
      setLoading(false)
    }
  }

  const rows = [
    { label: "Work",     value: draft.work.display },
    { label: "FX Line",  value: draft.fx_line.display },
    { label: "Discount", value: draft.discount.display },
    { label: "Deferred", value: draft.deferred.display },
    { label: "Total",    value: draft.total.display, bold: true },
  ]

  const isSent = (draft as Draft & { status?: string }).status === "SENT"

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold" style={{ fontFamily: "var(--font-serif)" }}>
            {isSent ? "Invoice Sent" : "Draft Invoice"}
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
        {!isSent && (
          <Button className="w-full" onClick={approve} disabled={loading}>
            {loading ? "Sending via PayPal…" : "Approve & Send via PayPal"}
          </Button>
        )}
        {isSent && (
          <div className="space-y-3">
            <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
              Invoice sent — the client can now pay directly on PayPal.
            </div>
            {draft.paypal_url ? (
              <a
                href={draft.paypal_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  width: "100%", padding: "12px 16px", boxSizing: "border-box",
                  background: "#0070ba", color: "white",
                  border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600,
                  textDecoration: "none", cursor: "pointer",
                }}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944 2.79A.859.859 0 0 1 5.79 2h7.602c2.633 0 4.447.603 5.395 1.794.896 1.122 1.078 2.588.546 4.361l-.003.012c-.65 2.29-2.4 3.735-4.933 4.082l-.022.003H10.59a.638.638 0 0 0-.63.539l-.794 5.025-.063.397-.42 2.657a.4.4 0 0 1-.395.467z"/></svg>
                Pay on PayPal
              </a>
            ) : (
              <p className="text-xs text-muted-foreground text-center">PayPal link not available</p>
            )}
            <div className="flex items-center justify-between pt-1">
              <button
                onClick={onDone}
                style={{ background: "none", border: "none", fontSize: 13, color: "#6b7280", cursor: "pointer", padding: 0 }}
              >
                Process another invoice
              </button>
              <button
                onClick={simulatePayment}
                disabled={simulating}
                style={{ background: "none", border: "none", fontSize: 11, color: "#9ca3af", cursor: "pointer", padding: 0, textDecoration: "underline" }}
                title="Skip PayPal login — triggers the same webhook handler"
              >
                {simulating ? "Processing…" : "Skip (demo mode)"}
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ScenarioPicker({ onPick }: { onPick: (file: File) => void }) {
  const [samples, setSamples] = useState<SampleInvoice[]>([])
  const [loading, setLoading] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    apiFetch<SampleInvoice[]>("/api/sample-invoices").then(setSamples).catch(() => {})
  }, [])

  const pickScenario = async (sample: SampleInvoice) => {
    setLoading(sample.id)
    try {
      const res = await fetch(`${BASE}/api/sample-invoices/${sample.id}/file`, { credentials: "include" })
      if (!res.ok) throw new Error("Failed to fetch sample")
      const blob = await res.blob()
      onPick(new File([blob], `${sample.id}.pdf`, { type: "application/pdf" }))
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to load scenario")
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="space-y-5">
      <div data-tour="scenarios" className="grid gap-4 sm:grid-cols-2">
        {samples.length === 0 && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36 w-full rounded-2xl" />)}
        {samples.map((s) => {
          const t = TREATMENTS.find((x) => x.client === s.client)
          const Icon = t?.icon
          return (
            <div key={s.id} className="relative flex flex-col overflow-hidden rounded-2xl border bg-white p-5">
              {t && <div className="absolute inset-x-0 top-0 h-1" style={{ background: t.accent }} />}
              <div className="flex items-start gap-3">
                {t && Icon && (
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg" style={{ background: t.soft, color: t.accent }}>
                    <Icon className="size-4.5" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-900">{s.client}</p>
                  {t && <p className="text-xs font-semibold" style={{ color: t.accent }}>Expected: {t.title}</p>}
                </div>
                <span className="text-base font-bold tabular-nums text-slate-900">{s.amount}</span>
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">{s.currency} to INR</span>
                <Button onClick={() => pickScenario(s)} disabled={loading !== null} className="h-9 rounded-full bg-[#0070ba] px-4 font-semibold hover:bg-[#005ea6]">
                  {loading === s.id ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-3.5" />}
                  Run agent
                </Button>
              </div>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        data-tour="dropzone"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) onPick(f) }}
        className={`flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed bg-white px-6 py-8 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${dragging ? "border-[#0070ba] bg-blue-50/50" : "border-slate-200 hover:border-slate-300"}`}
      >
        <Upload className="size-5 text-slate-400" />
        <span className="text-sm font-semibold text-slate-800">Drop your own invoice PDF</span>
        <span className="text-xs text-slate-500">or click to browse</span>
        <input ref={fileRef} type="file" accept=".pdf,application/pdf" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f) }} />
      </button>
    </div>
  )
}

export default function InvoicePage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [run, setRun] = useState<AgentRun | null>(null)
  const [polling, setPolling] = useState(false)
  const [answer, setAnswer] = useState("")
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    apiFetch<AgentRun[]>("/api/agent/runs", { credentials: "include" } as RequestInit).then((runs) => {
      const active = runs.map(normaliseRun).find((r) => r.status === "RUNNING" || r.status === "NEEDS_INPUT")
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
      toast.error("Only PDF invoices are supported"); return
    }
    const fd = new FormData()
    fd.append("file", file)
    setRun(null); setRunId(null)
    try {
      const res = await fetch(`${BASE}/api/agent/runs`, { method: "POST", body: fd, credentials: "include" })
      if (!res.ok) { const t = await res.text(); throw new Error(t) }
      const data: { id: string } = await res.json()
      setRunId(data.id)
      startPolling(data.id)
      toast.info("Agent started")
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Upload failed")
    }
  }

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
    stopPolling(); setRun(null); setRunId(null); setPolling(false)
    if (fileRef.current) fileRef.current.value = ""
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[#0b1f4d]" style={{ fontFamily: "var(--font-serif)" }}>New invoice</h1>
        <p className="mt-1 text-sm text-slate-600">Pick a client. The agent reads the PDF, picks a treatment and drafts it on PayPal.</p>
      </div>

      {!runId && <ScenarioPicker onPick={upload} />}

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
                    <Input value={answer} onChange={(e) => setAnswer(e.target.value)}
                      placeholder="Your answer…" onKeyDown={(e) => e.key === "Enter" && sendAnswer()} />
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
