"use client"

import React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  FilePlus,
  Users,
  Receipt,
  TrendingUp,
} from "lucide-react"
import useSWR from "swr"
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup,
  SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem,
} from "@/components/ui/sidebar"
import { apiFetch } from "@/lib/api"

const nav: Array<{ label: string; items: Array<{ href: string; icon: React.ComponentType<{ className?: string }>; title: string; badge?: boolean }> }> = [
  { label: "Workspace", items: [
    { href: "/",           icon: LayoutDashboard, title: "Dashboard" },
    { href: "/invoice",    icon: FilePlus,         title: "New Invoice" },
  ]},
  { label: "Records", items: [
    { href: "/clients",    icon: Users,    title: "Clients" },
    { href: "/invoices",   icon: Receipt,  title: "Invoices" },
  ]},
  { label: "Finance", items: [
    { href: "/proposals",  icon: TrendingUp, title: "Proposals", badge: true },
  ]},
]

export function AppSidebar() {
  const pathname = usePathname()
  const { data: proposals } = useSWR<Array<{ id: string }>>("/api/proposals", apiFetch, { refreshInterval: 30000 })
  const proposalCount = proposals?.length ?? 0

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-4 py-5 border-b border-sidebar-border">
        <div>
          <span className="text-lg font-bold tracking-tight" style={{ fontFamily: "var(--font-serif)" }}>
            NetFirst
          </span>
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5">
            Invoice Intelligence
          </p>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {nav.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      render={<Link href={item.href} />}
                      isActive={pathname === item.href}
                      tooltip={item.title}
                    >
                      <item.icon className="size-4" />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                    {item.badge && proposalCount > 0 && (
                      <SidebarMenuBadge>{proposalCount}</SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="px-4 py-3 border-t border-sidebar-border">
        <p className="text-[11px] text-muted-foreground">Sandbox environment</p>
      </SidebarFooter>
    </Sidebar>
  )
}
