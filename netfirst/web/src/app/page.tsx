"use client"

import Image from "next/image"
import { useState, useSyncExternalStore } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, FileText, Loader2, Sparkles, Wallet } from "lucide-react"
import { toast } from "sonner"
import { ParticleHero } from "@/components/ui/animated-hero"
import { Button } from "@/components/ui/button"
import { apiFetch } from "@/lib/api"

const FLOW = [
  { icon: FileText, label: "Drop an invoice PDF" },
  { icon: Sparkles, label: "Agent picks the FX treatment" },
  { icon: Wallet, label: "PayPal collects in any currency" },
]

export default function LandingPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const hasSession = useSyncExternalStore(
    () => () => {},
    () => document.cookie.split(";").some((c) => c.trim().startsWith("nf_session=")),
    () => false,
  )

  const startDemo = async () => {
    setLoading(true)
    try {
      await apiFetch("/api/demo/session", { method: "POST" })
      try { localStorage.removeItem("nf_tour_done") } catch {}
      router.push("/overview")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start a session")
      setLoading(false)
    }
  }

  return (
    <ParticleHero particleCount={19}>
      <div className="flex w-full max-w-2xl flex-col items-center text-center">
        <Image src="/logo-full.webp" alt="NetFirst FX" width={1776} height={887} priority className="h-auto w-full max-w-xl mix-blend-multiply" />

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {FLOW.map(({ icon: Icon, label }, i) => (
            <div key={label} className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-slate-700 backdrop-blur">
                <Icon className="size-3.5 text-[#0070ba]" aria-hidden="true" />
                {label}
              </span>
              {i < FLOW.length - 1 && <ArrowRight className="size-3.5 text-slate-300" aria-hidden="true" />}
            </div>
          ))}
        </div>

        <div className="mt-10 flex w-full max-w-sm flex-col gap-3">
          <Button size="lg" onClick={startDemo} disabled={loading} className="h-12 rounded-full bg-[#0070ba] text-base font-semibold hover:bg-[#005ea6]">
            {loading ? <><Loader2 className="size-4 animate-spin" /> Preparing your workspace</> : <>Start guided demo <ArrowRight className="size-4" /></>}
          </Button>
          {hasSession && (
            <Button size="lg" variant="outline" onClick={() => router.push("/overview")} className="h-12 rounded-full bg-white/80 text-base">
              Resume session
            </Button>
          )}
        </div>

        <p className="mt-8 text-xs text-slate-500">Isolated sandbox session. No real money moves.</p>
      </div>
    </ParticleHero>
  )
}
