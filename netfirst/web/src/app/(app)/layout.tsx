"use client"

import { usePathname } from "next/navigation"
import { PanelLeft } from "lucide-react"
import { AnimatedSidebarInset, AnimatedSidebarProvider, AnimatedSidebarTrigger } from "@/components/ui/animated-sidebar"
import dynamic from "next/dynamic"
import { TourButton } from "@/components/tour/tour"
import { treatmentBySlug } from "@/lib/treatments"

const AppSidebar = dynamic(() => import("@/components/app-sidebar").then((m) => m.AppSidebar), {
  ssr: false,
  loading: () => <div className="hidden w-64 shrink-0 border-r border-border bg-background md:block" />,
})

const TITLES: Record<string, string> = {
  "/overview": "Overview", "/invoice": "New invoice", "/invoices": "Invoices", "/clients": "Clients", "/proposals": "Settlements",
}

function useTitle() {
  const pathname = usePathname()
  if (pathname.startsWith("/treatments/")) return ["FX treatments", treatmentBySlug(pathname.split("/")[2])?.title ?? ""]
  return [TITLES[pathname] ?? ""]
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const crumbs = useTitle()
  return (
    <AnimatedSidebarProvider className="bg-[#f6f8fb]">
      <AppSidebar />
      <AnimatedSidebarInset className="bg-[#f6f8fb]">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-white/85 px-4 backdrop-blur">
          <AnimatedSidebarTrigger className="size-8 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <PanelLeft aria-hidden="true" className="size-4" />
          </AnimatedSidebarTrigger>
          <div className="h-5 w-px bg-border" />
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
            {crumbs.map((c, i) => (
              <span key={c} className={i === crumbs.length - 1 ? "font-semibold text-foreground" : "text-muted-foreground"}>
                {i > 0 && <span className="mr-2 text-muted-foreground/50">/</span>}
                {c}
              </span>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <TourButton />
          </div>
        </header>
        <div className="flex-1">{children}</div>
      </AnimatedSidebarInset>
    </AnimatedSidebarProvider>
  )
}
