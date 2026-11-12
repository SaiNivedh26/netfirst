"use client"

import Image from "next/image"
import { useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { BarChart3, FilePlus2, LayoutDashboard, Receipt, RotateCcw, Scale, Shapes, Users, X } from "lucide-react"
import useSWR from "swr"
import { toast } from "sonner"
import {
  AnimatedSidebar, AnimatedSidebarClose, AnimatedSidebarContent, AnimatedSidebarFooter, AnimatedSidebarGroup,
  AnimatedSidebarGroupContent, AnimatedSidebarGroupLabel, AnimatedSidebarHeader, AnimatedSidebarMenu,
  AnimatedSidebarMenuButton, AnimatedSidebarMenuItem, AnimatedSidebarMenuSub, AnimatedSidebarMenuSubButton,
  AnimatedSidebarMenuSubItem, AnimatedSidebarRail,
} from "@/components/ui/animated-sidebar"
import { apiFetch } from "@/lib/api"
import { TREATMENTS } from "@/lib/treatments"

export function AppSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { data: proposals, mutate } = useSWR<Array<{ id: string }>>("/api/proposals", apiFetch, { refreshInterval: 30000 })
  const [treatmentsOpen, setTreatmentsOpen] = useState(true)
  const go = (href: string) => () => router.push(href)
  const inTreatments = pathname.startsWith("/treatments/")

  const reset = async () => {
    try {
      await apiFetch("/api/demo/reset", { method: "POST" })
      await mutate()
      toast.success("Sandbox reset to the seeded scenarios")
      router.refresh()
      router.push("/overview")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reset failed")
    }
  }

  return (
    <AnimatedSidebar ariaLabel="NetFirst navigation" collapsible="icon">
      <AnimatedSidebarHeader className="p-3 pb-2" data-tour="brand">
        <div className="flex min-h-11 items-center gap-2.5 overflow-hidden px-1.5">
          <Image src="/logo-mark.png" alt="" width={239} height={208} className="h-8 w-auto shrink-0" />
          <div className="min-w-0 flex-1 group-data-[state=collapsed]/sidebar:hidden">
            <p className="truncate text-[15px] font-bold leading-tight tracking-tight text-[#0b1f4d]" style={{ fontFamily: "var(--font-serif)" }}>
              NetFirst <span className="text-[#1a73e8]">FX</span>
            </p>
            <p className="truncate text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">PayPal sandbox</p>
          </div>
          <AnimatedSidebarClose className="ml-auto text-muted-foreground hover:bg-muted md:hidden">
            <X aria-hidden="true" className="size-4" />
          </AnimatedSidebarClose>
        </div>
      </AnimatedSidebarHeader>

      <AnimatedSidebarContent className="px-2 pt-1">
        <AnimatedSidebarGroup>
          <AnimatedSidebarGroupLabel>Workspace</AnimatedSidebarGroupLabel>
          <AnimatedSidebarGroupContent>
            <AnimatedSidebarMenu>
              <AnimatedSidebarMenuItem>
                <AnimatedSidebarMenuButton icon={<LayoutDashboard className="size-4" />} isActive={pathname === "/overview"} onSelect={go("/overview")}>
                  Overview
                </AnimatedSidebarMenuButton>
              </AnimatedSidebarMenuItem>
              <AnimatedSidebarMenuItem data-tour="nav-invoice">
                <AnimatedSidebarMenuButton icon={<FilePlus2 className="size-4" />} isActive={pathname === "/invoice"} onSelect={go("/invoice")}>
                  New invoice
                </AnimatedSidebarMenuButton>
              </AnimatedSidebarMenuItem>
            </AnimatedSidebarMenu>
          </AnimatedSidebarGroupContent>
        </AnimatedSidebarGroup>

        <AnimatedSidebarGroup data-tour="nav-treatments">
          <AnimatedSidebarGroupLabel>FX treatments</AnimatedSidebarGroupLabel>
          <AnimatedSidebarGroupContent>
            <AnimatedSidebarMenu>
              <AnimatedSidebarMenuItem>
                <AnimatedSidebarMenuButton
                  icon={<Shapes className="size-4" />}
                  isActive={inTreatments && !treatmentsOpen}
                  ariaExpanded={treatmentsOpen}
                  onSelect={() => setTreatmentsOpen((o) => !o)}
                >
                  Scenarios
                </AnimatedSidebarMenuButton>
                <AnimatedSidebarMenuSub open={treatmentsOpen}>
                  {TREATMENTS.map((t) => (
                    <AnimatedSidebarMenuSubItem key={t.slug}>
                      <AnimatedSidebarMenuSubButton
                        isActive={pathname === `/treatments/${t.slug}`}
                        icon={<span className="size-1.5 rounded-full" style={{ background: t.accent }} />}
                        onSelect={go(`/treatments/${t.slug}`)}
                      >
                        {t.title}
                      </AnimatedSidebarMenuSubButton>
                    </AnimatedSidebarMenuSubItem>
                  ))}
                </AnimatedSidebarMenuSub>
              </AnimatedSidebarMenuItem>
            </AnimatedSidebarMenu>
          </AnimatedSidebarGroupContent>
        </AnimatedSidebarGroup>

        <AnimatedSidebarGroup>
          <AnimatedSidebarGroupLabel>Records</AnimatedSidebarGroupLabel>
          <AnimatedSidebarGroupContent>
            <AnimatedSidebarMenu>
              <AnimatedSidebarMenuItem>
                <AnimatedSidebarMenuButton icon={<Users className="size-4" />} isActive={pathname === "/clients"} onSelect={go("/clients")}>
                  Clients
                </AnimatedSidebarMenuButton>
              </AnimatedSidebarMenuItem>
              <AnimatedSidebarMenuItem>
                <AnimatedSidebarMenuButton icon={<Receipt className="size-4" />} isActive={pathname === "/invoices"} onSelect={go("/invoices")}>
                  Invoices
                </AnimatedSidebarMenuButton>
              </AnimatedSidebarMenuItem>
              <AnimatedSidebarMenuItem data-tour="nav-proposals">
                <AnimatedSidebarMenuButton
                  icon={<Scale className="size-4" />}
                  isActive={pathname === "/proposals"}
                  badge={proposals?.length ? <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">{proposals.length}</span> : undefined}
                  onSelect={go("/proposals")}
                >
                  Settlements
                </AnimatedSidebarMenuButton>
              </AnimatedSidebarMenuItem>
              <AnimatedSidebarMenuItem data-tour="nav-analytics">
                <AnimatedSidebarMenuButton icon={<BarChart3 className="size-4" />} href="/analytics">
                  Analytics
                </AnimatedSidebarMenuButton>
              </AnimatedSidebarMenuItem>
            </AnimatedSidebarMenu>
          </AnimatedSidebarGroupContent>
        </AnimatedSidebarGroup>
      </AnimatedSidebarContent>

      <AnimatedSidebarFooter className="border-none p-3">
        <button
          type="button"
          onClick={reset}
          className="flex min-h-9 w-full items-center gap-2.5 overflow-hidden rounded-xl px-3 text-left text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RotateCcw className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate group-data-[state=collapsed]/sidebar:hidden">Reset sandbox</span>
        </button>
      </AnimatedSidebarFooter>

      <AnimatedSidebarRail />
    </AnimatedSidebar>
  )
}
