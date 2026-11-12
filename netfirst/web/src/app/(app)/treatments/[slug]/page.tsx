import { notFound } from "next/navigation"
import { TREATMENTS } from "@/lib/treatments"
import { TreatmentView } from "./treatment-view"

export function generateStaticParams() {
  return TREATMENTS.map((t) => ({ slug: t.slug }))
}

export default async function TreatmentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  if (!TREATMENTS.some((t) => t.slug === slug)) notFound()
  return <TreatmentView slug={slug} />
}
