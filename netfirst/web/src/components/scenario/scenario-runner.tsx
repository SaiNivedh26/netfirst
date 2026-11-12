"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import useSWR, { useSWRConfig } from "swr"
import {
  ArrowRight, BarChart3, Check, CircleAlert, ExternalLink, FileText, Loader2, Play, RotateCcw, Send, Wallet, X,
} from "lucide-react"
import { toast } from "sonner"
import { apiFetch, normaliseRun, type AgentRun, type Client, type Draft, type LedgerRow, type Money, type Proposal, type SampleInvoice } from "@/lib/api"
import { TREATMENTS, type TreatmentDef } from "@/lib/treatments"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useGuide } from "./use-guide"

type Phase = "pick" | "processing" | "question" | "review" | "sent" | "paid" | "settled" | "failed"

const STAGES: { key: Phase[]; label: string }[] = [
  { key: ["pick"], label: "Select invoice" },
  { key: ["processing", "question", "failed"], label: "Agent processes" },
  { key: ["review"], label: "Review outcome" },
  { key: ["sent"], label: "Send and collect" },
  { key: ["paid", "settled"], label: "Ledger impact" },
]

const TOOL_LABEL: Record<string, string> = {
  validate_extraction: "Read the invoice PDF",
  find_client: "Match the client",
  propose_client: "Create the client",
  get_client_history: "Check payment history",
  get_fx_quote: "Fetch the PayPal FX rate",
  price_invoice: "Price the invoice",
  check_policy: "Apply guardrails",
  create_paypal_draft: "Draft it on PayPal",
  ask_user: "Ask you a question",
}
const EXPECTED_TOOLS = ["validate_extraction", "find_client", "get_client_history", "price_invoice", "check_policy", "create_paypal_draft"]

const LEDGER_LABEL: Record<string, string> = {
  INVOICE: "Invoice posted", PAYMENT: "Payment received", TRUE_UP: "Rate swing", FX_DEFER: "FX cost deferred",
  SETTLEMENT: "Balance settled", CREDIT_APPLIED: "Credit applied",
}

const fmtMoney = (m: Money) => m.display

// Tool summaries are plain text from the backend; classify them so rejected calls stay visible.
function stepKind(summary: string): "ok" | "warn" | "fail" {
  if (/failed|not valid|first$|no longer active|^No existing client/i.test(summary)) return "fail"
  if (/not allowed/i.test(summary)) return "warn"
  return "ok"
}

export function ScenarioRunner({ t }: { t: TreatmentDef }) {
  const router = useRouter()
  const { mutate } = useSWRConfig()
  const { data: samples } = useSWR<SampleInvoice[]>("/api/sample-invoices", apiFetch)
  const { data: clients } = useSWR<Client[]>("/api/clients", apiFetch)
  const sample = samples?.find((s) => s.client === t.client)
  const client = clients?.find((c) => c.name === t.client)

  const [guided, setGuided] = useState(true)
  const [phase, setPhase] = useState<Phase>("pick")
  const [busy, setBusy] = useState(false)
  const [run, setRun] = useState<AgentRun | null>(null)
  const [answer, setAnswer] = useState("")
  const [balanceBefore, setBalanceBefore] = useState<Money | null>(null)
  const [entries, setEntries] = useState<LedgerRow[]>([])
  const [settlement, setSettlement] = useState<{ invoiceId: string; url: string | null; amount: Money } | null>(null)
  const poll = useRef<ReturnType<typeof setInterval> | null>(null)
  const { show, clear } = useGuide(guided)
  const draft: Draft | null = run?.draft ?? null
  const next = TREATMENTS[(TREATMENTS.findIndex((x) => x.slug === t.slug) + 1) % TREATMENTS.length]

  const refreshAll = useCallback(
    () => Promise.all(["/api/clients", "/api/ledger", "/api/invoices", "/api/proposals", "/api/summary", "/api/agent/runs"].map((k) => mutate(k))),
    [mutate],
  )

  const stopPoll = () => {
    if (poll.current) clearInterval(poll.current)
    poll.current = null
  }
  useEffect(() => stopPoll, [])

  const watch = useCallback((id: string) => {
    stopPoll()
    poll.current = setInterval(async () => {
      try {
        const r = normaliseRun(await apiFetch<AgentRun>(`/api/agent/runs/${id}`))
        setRun(r)
        if (r.status === "DRAFT_READY") { stopPoll(); setPhase("review") }
        else if (r.status === "NEEDS_INPUT") { stopPoll(); setPhase("question") }
        else if (r.status === "FAILED") { stopPoll(); setPhase("failed") }
      } catch {
        stopPoll()
        setPhase("failed")
      }
    }, 1200)
  }, [])

  // Guidance follows the workflow: each phase spotlights the one action that moves it forward.
  useEffect(() => {
    if (phase === "pick" && sample) show("[data-guide='start']", "Start here", `This is ${t.client}'s real invoice PDF. Send it to the agent.`, "top")
    else if (phase === "processing") show("[data-guide='agent']", "The agent is working", "Each line is a tool call: reading the PDF, matching the client, checking history, pricing with a live PayPal rate.", "right")
    else if (phase === "question") show("[data-guide='question']", "The agent needs one answer", "Reply and it picks up where it stopped.", "top")
    else if (phase === "review") show("[data-guide='impact']", `It chose ${draft?.treatment.replace("_", "-") ?? t.title}`, "This is what that decision does for you. When you are happy, send it.", "left")
    else if (phase === "sent") show("[data-guide='pay']", "Invoice is live on PayPal", "Open it as the client would, or record the payment to trigger the same webhook PayPal sends.", "top")
    else if (phase === "paid" && t.slug === "settle") show("[data-guide='settle']", "Balance is over the cap", "Approve the settlement. PayPal bills the client for the whole FX balance in one invoice.", "top")
    else if (phase === "paid" || phase === "settled") show("[data-guide='ledger']", "What changed in your books", "The exact ledger entries this invoice posted, and the client's balance before and after.", "top")
    else clear()
  }, [phase, sample, show, clear, t, draft?.treatment])

  const start = async () => {
    if (!sample) return
    setBusy(true)
    try {
      // Restore this client's seeded history so every run reaches the same treatment.
      await apiFetch(`/api/demo/scenario/${t.slug}/reset`, { method: "POST" })
      const fresh = await apiFetch<Client[]>("/api/clients")
      await mutate("/api/clients", fresh, { revalidate: false })
      refreshAll()
      setBalanceBefore(fresh.find((c) => c.name === t.client)?.fx_balance ?? null)
      const res = await fetch(`/api/sample-invoices/${sample.id}/file`, { credentials: "include" })
      if (!res.ok) throw new Error("Could not load the invoice PDF")
      const fd = new FormData()
      fd.append("file", new File([await res.blob()], `${sample.id}.pdf`, { type: "application/pdf" }))
      const { id } = await apiFetch<{ id: string }>("/api/agent/runs", { method: "POST", body: fd })
      setRun({ id, file_name: sample.id, status: "RUNNING", question: null, extracted: null, steps: [], draft: null })
      setPhase("processing")
      watch(id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the agent")
    } finally {
      setBusy(false)
    }
  }

  const sendAnswer = async () => {
    if (!run || !answer.trim()) return
    try {
      await apiFetch(`/api/agent/runs/${run.id}/answer`, { method: "POST", body: JSON.stringify({ answer: answer.trim() }) })
      setAnswer("")
      setPhase("processing")
      watch(run.id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send the answer")
    }
  }

  const approve = async () => {
    if (!run) return
    setBusy(true)
    try {
      await apiFetch(`/api/agent/runs/${run.id}/approve`, { method: "POST" })
      setRun(normaliseRun(await apiFetch<AgentRun>(`/api/agent/runs/${run.id}`)))
      setPhase("sent")
      refreshAll()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PayPal did not accept the invoice")
    } finally {
      setBusy(false)
    }
  }

  const loadEntries = async (invoiceIds: string[]) => {
    const ledger = await apiFetch<LedgerRow[]>("/api/ledger")
    setEntries(ledger.filter((e) => e.invoice_id && invoiceIds.includes(e.invoice_id)).reverse())
  }

  const pay = async () => {
    if (!draft) return
    setBusy(true)
    try {
      await apiFetch(`/api/demo/simulate-payment/${draft.invoice_id}`, { method: "POST" })
      await loadEntries([draft.invoice_id])
      await refreshAll()
      setPhase("paid")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Payment failed")
    } finally {
      setBusy(false)
    }
  }

  const settle = async () => {
    setBusy(true)
    try {
      const proposals = await apiFetch<Proposal[]>("/api/proposals")
      const p = proposals.find((x) => x.client_id === client?.id)
      if (!p) throw new Error("No open settlement for this client")
      const res = await apiFetch<{ invoice_id: string | null; paypal_url: string | null }>(`/api/proposals/${p.id}/approve`, { method: "POST" })
      if (res.invoice_id) {
        setSettlement({ invoiceId: res.invoice_id, url: res.paypal_url, amount: p.amount })
        await loadEntries([draft?.invoice_id ?? "", res.invoice_id])
      }
      await refreshAll()
      setPhase("settled")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Settlement failed")
    } finally {
      setBusy(false)
    }
  }

  const restart = () => {
    stopPoll()
    setRun(null); setEntries([]); setSettlement(null); setBalanceBefore(null)
    setPhase("pick")
  }

  const stageIndex = STAGES.findIndex((s) => s.key.includes(phase))
  const balanceAfter = client?.fx_balance

  return (
    <section data-tour="scenario-runner" className="overflow-hidden rounded-2xl border bg-white">
      <header className="flex flex-wrap items-center gap-3 border-b px-5 py-3.5">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Run the scenario</p>
          <h2 className="text-lg font-bold text-slate-900" style={{ fontFamily: "var(--font-serif)" }}>
            Invoice {t.client}, end to end
          </h2>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600">
          <input type="checkbox" checked={guided} onChange={(e) => setGuided(e.target.checked)} className="size-3.5 accent-[#0070ba]" />
          Guide me
        </label>
        {phase !== "pick" && (
          <Button variant="ghost" size="sm" onClick={restart} className="h-8 gap-1.5 rounded-full text-slate-600">
            <RotateCcw className="size-3.5" /> Restart
          </Button>
        )}
      </header>

      <ol className="flex border-b bg-slate-50/60 px-2">
        {STAGES.map((s, i) => {
          const done = i < stageIndex
          const active = i === stageIndex
          return (
            <li key={s.label} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5">
              <span
                className="grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold transition-colors"
                style={{ background: done || active ? t.accent : "#e2e8f0", color: done || active ? "#fff" : "#64748b" }}
              >
                {done ? <Check className="size-3" /> : i + 1}
              </span>
              <span className={`hidden truncate text-xs font-semibold md:inline ${active ? "text-slate-900" : "text-slate-500"}`}>{s.label}</span>
            </li>
          )
        })}
      </ol>

      <div className="p-5">
        {phase === "pick" && (
          <div className="grid gap-5 md:grid-cols-[1fr_1.1fr]">
            <div className="overflow-hidden rounded-xl border bg-slate-50">
              {sample ? (
                <iframe title={`${t.client} invoice`} src={`/api/sample-invoices/${sample.id}/file#toolbar=0&navpanes=0&view=FitH`} className="h-72 w-full" />
              ) : <div className="h-72 animate-pulse" />}
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <FileText className="size-4 text-slate-400" /> {sample?.id ?? "Loading"}.pdf
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-slate-50 px-3 py-2"><dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Client</dt><dd className="font-semibold text-slate-900">{t.client}</dd></div>
                <div className="rounded-lg bg-slate-50 px-3 py-2"><dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Amount</dt><dd className="font-semibold tabular-nums text-slate-900">{sample?.amount ?? ""}</dd></div>
                <div className="rounded-lg bg-slate-50 px-3 py-2"><dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Converts</dt><dd className="font-semibold text-slate-900">{sample?.currency} to INR</dd></div>
                <div className="rounded-lg bg-slate-50 px-3 py-2"><dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Balance now</dt><dd className="font-semibold tabular-nums text-slate-900">{client?.fx_balance.display ?? ""}</dd></div>
              </dl>
              <p className="mt-4 text-sm text-slate-600">Expected outcome: <span className="font-semibold" style={{ color: t.accent }}>{t.title}</span>. {t.rule}.</p>
              <Button data-guide="start" onClick={start} disabled={!sample || busy} className="mt-auto h-11 self-start rounded-full bg-[#0070ba] px-6 text-sm font-semibold hover:bg-[#005ea6]">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                Process this invoice
              </Button>
            </div>
          </div>
        )}

        {(phase === "processing" || phase === "question" || phase === "failed") && (
          <div className="grid gap-5 md:grid-cols-[1.2fr_1fr]">
            <ul data-guide="agent" className="max-h-96 space-y-1 overflow-y-auto rounded-xl border p-3">
              {run?.steps.map((step, i) => {
                const kind = stepKind(step.summary)
                return (
                  <li key={i} className="flex items-start gap-3 rounded-lg px-2 py-2">
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center">
                      {kind === "fail" ? <X className="size-4 text-red-600" /> : kind === "warn" ? <CircleAlert className="size-4 text-amber-600" /> : <Check className="size-4 text-emerald-600" />}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">
                        {TOOL_LABEL[step.tool] ?? step.tool}
                        {kind === "fail" && <span className="ml-2 text-xs font-semibold text-red-600">Rejected, agent retries</span>}
                      </p>
                      <p className={`text-xs ${kind === "fail" ? "text-red-700" : "text-slate-500"}`}>{step.summary}</p>
                    </div>
                  </li>
                )
              })}
              {phase === "processing" && EXPECTED_TOOLS.filter((tool) => !run?.steps.some((s) => s.tool === tool && stepKind(s.summary) !== "fail")).map((tool, i) => (
                <li key={tool} className="flex items-start gap-3 rounded-lg px-2 py-2 opacity-50">
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center">
                    {i === 0 ? <Loader2 className="size-4 animate-spin text-[#0070ba]" /> : <span className="size-1.5 rounded-full bg-slate-300" />}
                  </span>
                  <p className="text-sm font-semibold text-slate-900">{TOOL_LABEL[tool]}</p>
                </li>
              ))}
            </ul>
            <div className="flex flex-col justify-center rounded-xl bg-slate-50 p-5">
              {phase === "processing" && (
                <>
                  <p className="text-sm font-semibold text-slate-900">Processing {t.client}&apos;s invoice</p>
                  <p className="mt-1 text-sm text-slate-600">Usually 10 to 20 seconds. No manual data entry.</p>
                </>
              )}
              {phase === "question" && (
                <div data-guide="question" className="space-y-3">
                  <p className="text-sm font-semibold text-slate-900">{run?.question}</p>
                  <div className="flex gap-2">
                    <Input value={answer} onChange={(e) => setAnswer(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendAnswer()} placeholder="Your answer" />
                    <Button onClick={sendAnswer} disabled={!answer.trim()}>Reply</Button>
                  </div>
                </div>
              )}
              {phase === "failed" && (
                <div className="space-y-3">
                  <p className="flex items-center gap-2 text-sm font-semibold text-red-700"><CircleAlert className="size-4" /> The agent stopped</p>
                  <p className="text-sm text-slate-600">{run?.question}</p>
                  <Button variant="outline" onClick={restart} className="rounded-full">Try again</Button>
                </div>
              )}
            </div>
          </div>
        )}

        {phase === "review" && draft && (
          <div className="grid gap-5 md:grid-cols-[1fr_1.1fr]">
            <InvoiceSummary draft={draft} />
            <div data-guide="impact" className="flex flex-col rounded-xl border p-4" style={{ borderColor: t.soft, background: `${t.soft}55` }}>
              <Impact t={t} draft={draft} />
              <p className="mt-3 text-xs text-slate-600">{draft.reason}</p>
              <Button onClick={approve} disabled={busy} className="mt-4 h-11 rounded-full bg-[#0070ba] text-sm font-semibold hover:bg-[#005ea6]">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                Approve and send via PayPal
              </Button>
            </div>
          </div>
        )}

        {phase === "sent" && draft && (
          <div className="grid gap-5 md:grid-cols-[1fr_1.1fr]">
            <InvoiceSummary draft={draft} />
            <div data-guide="pay" className="flex flex-col gap-3 rounded-xl border p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700"><Check className="size-4" /> Sent to {client?.email ?? "the client"}</p>
              <p className="text-sm text-slate-600">PayPal invoice <span className="font-mono text-xs">{draft.paypal_invoice_id}</span> is live in the sandbox.</p>
              {draft.paypal_url && (
                <a href={draft.paypal_url} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-[#0070ba] px-5 text-sm font-semibold text-[#0070ba] hover:bg-blue-50">
                  Open as the client <ExternalLink className="size-3.5" />
                </a>
              )}
              <Button onClick={pay} disabled={busy} className="h-11 rounded-full bg-[#0070ba] text-sm font-semibold hover:bg-[#005ea6]">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Wallet className="size-4" />}
                Record client payment
              </Button>
              <p className="text-xs text-slate-500">Runs the same handler as PayPal&apos;s INVOICING.INVOICE.PAID webhook, using today&apos;s PayPal rate.</p>
              <a href={`/analytics/netfirst-invoices?focus=${draft.invoice_id}&scenario=${t.slug}`} className="inline-flex items-center gap-1.5 self-start text-sm font-semibold text-[#0070ba] hover:underline">
                <BarChart3 className="size-4" /> Find it in Analytics
              </a>
            </div>
          </div>
        )}

        {(phase === "paid" || phase === "settled") && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat label="FX balance before" value={balanceBefore?.display ?? ""} />
              <Stat label="FX balance now" value={balanceAfter?.display ?? ""} accent={t.accent} />
              <Stat label="Entries posted" value={String(entries.length)} />
            </div>

            <div data-guide="ledger" className="overflow-hidden rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <tr><th className="px-4 py-2">Entry</th><th className="px-4 py-2">Detail</th><th className="px-4 py-2 text-right">Amount (INR)</th></tr>
                </thead>
                <tbody className="divide-y">
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td className="px-4 py-2.5 font-semibold text-slate-900">{LEDGER_LABEL[e.type] ?? e.type}</td>
                      <td className="px-4 py-2.5 text-slate-600">{e.note}</td>
                      <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${e.amount.minor < 0 ? "text-red-700" : "text-slate-900"}`}>{fmtMoney(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {phase === "paid" && t.slug === "settle" && (
              <div data-guide="settle" className="flex flex-wrap items-center gap-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                <p className="min-w-0 flex-1 text-sm text-emerald-900">
                  <span className="font-semibold">Settlement proposed.</span> {client?.name} owes {client?.fx_balance.display} in FX, over the {client?.cap.display} cap.
                </p>
                <Button onClick={settle} disabled={busy} className="h-10 rounded-full bg-emerald-700 px-5 font-semibold hover:bg-emerald-800">
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  Approve settlement
                </Button>
              </div>
            )}

            {settlement && (
              <p className="text-sm text-slate-600">
                Settlement invoice for {settlement.amount.display} sent on PayPal.{" "}
                {settlement.url && <a href={settlement.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#0070ba] hover:underline">Open it</a>}
              </p>
            )}

            {(phase === "settled" || t.slug !== "settle") && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <a
                  data-guide="analytics"
                  href={`/analytics/netfirst-invoices?focus=${draft?.invoice_id ?? ""}&scenario=${t.slug}`}
                  className="inline-flex h-10 items-center gap-2 rounded-full border px-5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                >
                  <BarChart3 className="size-4" /> Find it in Analytics
                </a>
                <Button onClick={() => router.push(`/treatments/${next.slug}`)} className="h-10 rounded-full bg-[#0070ba] px-5 font-semibold hover:bg-[#005ea6]">
                  Next scenario: {next.title} <ArrowRight className="size-4" />
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums" style={{ fontFamily: "var(--font-serif)", color: accent ?? "#0f172a" }}>{value}</p>
    </div>
  )
}

function InvoiceSummary({ draft }: { draft: Draft }) {
  const rows: [string, string, boolean?][] = [
    ["Work", draft.work.display],
    ["FX line", draft.fx_line.display],
    ...(draft.discount.minor ? [["Credit applied", `- ${draft.discount.display}`] as [string, string]] : []),
    ["Client pays", draft.total.display, true],
  ]
  return (
    <div className="rounded-xl border">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <p className="text-sm font-semibold text-slate-900">PayPal invoice</p>
        <span className="text-xs text-slate-500">Rate {Number(draft.rate).toFixed(4)} · {draft.rate_source}</span>
      </div>
      <dl className="divide-y text-sm">
        {rows.map(([k, v, bold]) => (
          <div key={k} className="flex justify-between px-4 py-2.5">
            <dt className="text-slate-600">{k}</dt>
            <dd className={`tabular-nums ${bold ? "font-bold text-slate-900" : "text-slate-800"}`}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function Impact({ t, draft }: { t: TreatmentDef; draft: Draft }) {
  const matched = draft.treatment === t.code || (t.slug === "settle" && draft.treatment !== "DEFER")
  const lines: Record<string, { head: string; value: string; body: string }> = {
    CHARGE: { head: "FX cost recovered upfront", value: draft.fx_line.display, body: "Added as a line item. You receive the full amount; nothing is carried forward." },
    TRUE_UP: {
      head: draft.discount.minor ? "Credit returned automatically" : "Rate risk netted, not guessed",
      value: draft.discount.minor ? draft.discount.display : draft.fx_line.display,
      body: draft.discount.minor
        ? "Past rate swings went the client's way, so the agent applied them as a discount. Payment-day swings post to the ledger."
        : "Invoiced at today's PayPal rate. Any movement by payment day posts to the FX ledger.",
    },
    DEFER: { head: "Clean invoice, no FX line", value: draft.deferred.display, body: "The FX cost is carried to the client's running balance and settled on the quarterly statement." },
  }
  const l = lines[draft.treatment]
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="rounded-full px-2.5 py-0.5 text-xs font-bold text-white" style={{ background: TREATMENTS.find((x) => x.code === draft.treatment)?.accent ?? t.accent }}>
          {draft.treatment.replace("_", "-")}
        </span>
        <span className={`text-xs font-semibold ${matched ? "text-emerald-700" : "text-amber-700"}`}>{matched ? "As expected" : `Expected ${t.title}`}</span>
      </div>
      {t.slug === "settle" && (
        <p className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-xs font-medium text-slate-700">Guardrail: DEFER blocked because the FX balance is already over its cap.</p>
      )}
      <p className="mt-3 text-sm font-semibold text-slate-900">{l?.head}</p>
      <p className="text-2xl font-bold tabular-nums" style={{ fontFamily: "var(--font-serif)", color: t.accent }}>{l?.value}</p>
      <p className="mt-1 text-sm text-slate-600">{l?.body}</p>
    </div>
  )
}
