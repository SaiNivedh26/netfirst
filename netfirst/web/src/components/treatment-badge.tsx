import { Badge } from "@/components/ui/badge"

const config = {
  CHARGE:   { label: "Charge",   className: "border-amber-200 text-amber-700 bg-amber-50" },
  TRUE_UP:  { label: "True-Up",  className: "border-blue-200 text-blue-700 bg-blue-50" },
  DEFER:    { label: "Defer",    className: "border-violet-200 text-violet-700 bg-violet-50" },
} as const

export function TreatmentBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-muted-foreground text-xs">—</span>
  const c = config[value as keyof typeof config]
  if (!c) return <Badge variant="outline">{value}</Badge>
  return <Badge variant="outline" className={c.className}>{c.label}</Badge>
}

const statusConfig = {
  DRAFT:            "border-slate-200 text-slate-600 bg-slate-50",
  SENT:             "border-blue-200 text-blue-700 bg-blue-50",
  PAID:             "border-green-200 text-green-700 bg-green-50",
  FAILED:           "border-red-200 text-red-600 bg-red-50",
  CANCELLED:        "border-red-200 text-red-600 bg-red-50",
  RUNNING:          "border-blue-200 text-blue-700 bg-blue-50",
  DRAFT_READY:      "border-green-200 text-green-700 bg-green-50",
  NEEDS_INPUT:      "border-amber-200 text-amber-700 bg-amber-50",
} as const

export function StatusBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-muted-foreground text-xs">—</span>
  const cls = statusConfig[value as keyof typeof statusConfig] ?? "border-slate-200 text-slate-600 bg-slate-50"
  const label = value.replace(/_/g, " ")
  return <Badge variant="outline" className={cls}>{label}</Badge>
}
