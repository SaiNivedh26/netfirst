"use client"

import "driver.js/dist/driver.css"
import { driver, type DriveStep } from "driver.js"
import { useCallback, useEffect } from "react"
import { usePathname } from "next/navigation"
import { Compass } from "lucide-react"
import { Button } from "@/components/ui/button"

const DONE_KEY = "nf_tour_done"

const OVERVIEW: DriveStep[] = [
  { popover: { title: "Welcome to NetFirst FX", description: "An AI agent that invoices foreign clients on PayPal and decides who absorbs the currency risk. This takes about a minute." } },
  { element: "[data-tour='kpis']", popover: { title: "Your FX position", description: "Everything invoiced this quarter, and the net FX balance clients owe you or you owe them.", side: "bottom" } },
  { element: "[data-tour='treatments']", popover: { title: "Four ways to handle FX", description: "Each card is a live client in this sandbox. The agent picks one of these on every invoice, based on payment history.", side: "top" } },
  { element: "[data-tour='treatment-charge']", popover: { title: "Run a scenario", description: "Click a card to process that client's real invoice end to end, guided step by step.", side: "top" } },
  { element: "[data-tour='nav-invoice']", popover: { title: "Try it yourself", description: "Pick a sample invoice. Watch the agent extract it, choose a treatment, and draft it on PayPal.", side: "right" } },
  { element: "[data-tour='nav-proposals']", popover: { title: "Settlements", description: "When a balance hits its cap, the agent drafts a settlement for you to approve.", side: "right" } },
  { element: "[data-tour='nav-analytics']", popover: { title: "Analytics", description: "Every PayPal invoice in one grid, with FX rate trends.", side: "right" } },
  { element: "[data-tour='tour-button']", popover: { title: "Replay any time", description: "Each page has its own short tour.", side: "bottom", align: "end" } },
]

const TREATMENT: DriveStep[] = [
  { element: "[data-tour='treatment-hero']", popover: { title: "The rule", description: "When the agent picks this treatment, and what happens to the FX cost.", side: "bottom" } },
  { element: "[data-tour='scenario-runner']", popover: { title: "Run it for real", description: "Process the client's actual invoice, send it on PayPal, record the payment and watch the ledger move. Each step is highlighted as you go.", side: "top" } },
  { element: "[data-tour='treatment-client']", popover: { title: "Client history", description: "The seeded history that leads the agent to this treatment, and the balance against its cap.", side: "top" } },
  { element: "[data-tour='treatment-grid']", popover: { title: "Invoices and ledger", description: "Every invoice and ledger posting for this client, in AG Grid. Your new invoice appears here.", side: "top" } },
]

const INVOICE: DriveStep[] = [
  { element: "[data-tour='scenarios']", popover: { title: "Pick a scenario", description: "Each sample PDF belongs to a seeded client, so the agent reaches a different treatment for each.", side: "bottom" } },
  { element: "[data-tour='dropzone']", popover: { title: "Or upload your own", description: "Any invoice PDF works. The agent asks if something is missing.", side: "top" } },
]

const TOURS: Record<string, DriveStep[]> = { "/overview": OVERVIEW, "/invoice": INVOICE }

function stepsFor(pathname: string): DriveStep[] {
  if (pathname.startsWith("/treatments/")) return TREATMENT
  return TOURS[pathname] ?? []
}

function visible(step: DriveStep) {
  if (!step.element) return true
  const el = document.querySelector(step.element as string)
  if (!el) return false
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}

export function startTour(pathname: string) {
  const steps = stepsFor(pathname).filter(visible)
  if (!steps.length) return
  const d = driver({
    steps,
    showProgress: true,
    progressText: "{{current}} of {{total}}",
    nextBtnText: "Next",
    prevBtnText: "Back",
    doneBtnText: "Done",
    popoverClass: "nf-tour",
    overlayColor: "#0b1b33",
    overlayOpacity: 0.45,
    stagePadding: 6,
    stageRadius: 12,
    smoothScroll: true,
    onDestroyed: () => {
      try { localStorage.setItem(DONE_KEY, "1") } catch {}
    },
  })
  d.drive()
}

export function TourButton() {
  const pathname = usePathname()
  const available = stepsFor(pathname).length > 0

  useEffect(() => {
    if (pathname !== "/overview") return
    let done = false
    try { done = localStorage.getItem(DONE_KEY) === "1" } catch {}
    if (done) return
    const t = setTimeout(() => startTour(pathname), 900)
    return () => clearTimeout(t)
  }, [pathname])

  const start = useCallback(() => startTour(pathname), [pathname])
  if (!available) return null

  return (
    <Button data-tour="tour-button" variant="outline" size="sm" onClick={start} className="h-8 gap-1.5 rounded-full px-3">
      <Compass className="size-3.5" />
      Take the tour
    </Button>
  )
}
