"use client"

import Link from "next/link"
import { usePathname } from 'next/navigation'
import { Inbox, Mail, Settings, Key, Workflow } from 'lucide-react'
import { useAuth } from "@/components/auth-provider"
import { UserMenu } from "@/components/user-menu"
import { cn } from "@/lib/utils"

const navigation = [
  { name: "Dashboard", icon: Inbox, href: "/", current: false },
  { name: "Emails", icon: Mail, href: "/emails", current: false },
  { name: "Automations", icon: Workflow, href: "/automations", current: false },
{ name: "API Keys", icon: Key, href: "/api-keys", current: false },
{ name: "Settings", icon: Settings, href: "/settings", current: false },
]

export function Sidebar() {
  const pathname = usePathname()
  const { user } = useAuth()
  const currentOrg = user?.organizations?.[0]
  const orgName = currentOrg?.name ?? "Organization"
  const orgInitial = orgName.charAt(0).toUpperCase()

  return (
    <div className="hidden lg:flex flex-col h-screen w-64 bg-sidebar border-r border-sidebar-border">
      {/* Org Display */}
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground font-semibold text-sm">
            {orgInitial}
          </div>
          <span className="text-sm font-medium truncate flex-1">
            {orgName}
          </span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {navigation.map((item) => (
          <Link
            key={item.name}
            href={item.href}
            className={cn(
              "flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors",
              pathname === item.href
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}
          >
            <item.icon className="h-5 w-5 shrink-0" />
            {item.name}
          </Link>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-sidebar-border">
        <UserMenu />
      </div>
    </div>
  )
}
