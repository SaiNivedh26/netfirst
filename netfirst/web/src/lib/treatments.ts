import { Banknote, Layers, RefreshCcw, Scale, type LucideIcon } from "lucide-react"

export type TreatmentSlug = "charge" | "true-up" | "defer" | "settle"

export interface TreatmentDef {
  slug: TreatmentSlug
  code: "CHARGE" | "TRUE_UP" | "DEFER" | "SETTLE"
  title: string
  tagline: string
  rule: string
  steps: [string, string, string]
  client: string
  icon: LucideIcon
  accent: string
  soft: string
}

export const TREATMENTS: TreatmentDef[] = [
  {
    slug: "charge", code: "CHARGE", title: "Charge", icon: Banknote,
    tagline: "FX cost billed upfront on the invoice.",
    rule: "New clients, fewer than 2 paid invoices",
    steps: ["Quote the PayPal rate", "Add an FX line to the invoice", "Client pays it, nothing carried"],
    client: "Marks & Spencer", accent: "#b45309", soft: "#fef3c7",
  },
  {
    slug: "true-up", code: "TRUE_UP", title: "True-Up", icon: RefreshCcw,
    tagline: "Rate swings between send and payment are netted later.",
    rule: "Reliable payers, 2 or more paid invoices",
    steps: ["Invoice at today's rate", "Measure the rate on payment day", "Post the swing to the FX ledger"],
    client: "Apple Green Ltd", accent: "#1d4ed8", soft: "#dbeafe",
  },
  {
    slug: "defer", code: "DEFER", title: "Defer", icon: Layers,
    tagline: "FX cost carried to a running balance, not the invoice.",
    rule: "Trusted clients, 3 or more paid, balance under cap",
    steps: ["Send a clean invoice", "Post FX cost to the balance", "Settle it on the quarterly statement"],
    client: "Eurotech GmbH", accent: "#6d28d9", soft: "#ede9fe",
  },
  {
    slug: "settle", code: "SETTLE", title: "Settlement", icon: Scale,
    tagline: "Balance hit its cap, so the agent proposes a settlement.",
    rule: "FX balance at cap or older than 90 days",
    steps: ["Balance crosses the cap", "Agent drafts a settlement", "You approve, PayPal bills it"],
    client: "Global Freight Co", accent: "#047857", soft: "#d1fae5",
  },
]

export const treatmentBySlug = (slug: string) => TREATMENTS.find((t) => t.slug === slug)
