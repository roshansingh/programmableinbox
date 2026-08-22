"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from 'next/navigation'
import { Inbox, Mail, Phone, Settings, ChevronDown, Plus, X, Workflow, CreditCard } from 'lucide-react'
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { useAuth } from "@/components/auth-provider"
import { UserMenu } from "@/components/user-menu"
import { cn } from "@/lib/utils"

const BASE_NAVIGATION = [
  { name: "Dashboard", icon: Inbox, href: "/", current: false },
  { name: "Emails", icon: Mail, href: "/emails", current: false },
  { name: "Automations", icon: Workflow, href: "/automations", current: false },
  { name: "Phone Numbers", icon: Phone, href: "#phones", current: false },
]

const SETTINGS_ITEM = { name: "Settings", icon: Settings, href: "/settings", current: false }

/**
 * See the matching note in sidebar.tsx: a plan is present exactly when
 * `USE_COMMERCIAL=true` and Stripe is configured, so this is the whole gate.
 */
const BILLING_ITEM = { name: "Billing", icon: CreditCard, href: "/billing", current: false }

interface MobileSidebarProps {
  open: boolean
  onClose: () => void
}

export function MobileSidebar({ open, onClose }: MobileSidebarProps) {
  const pathname = usePathname()
  const { user, plan } = useAuth()
  const organizations = user?.organizations ?? []
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null)
  const currentOrg =
    organizations.find((org) => org.id === selectedOrgId) ?? organizations[0] ?? null
  const orgName = currentOrg?.name ?? "Organization"
  const navigation = [...BASE_NAVIGATION, ...(plan ? [BILLING_ITEM] : []), SETTINGS_ITEM]

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="left" className="p-0 w-64">
        <div className="flex flex-col h-full bg-sidebar">
          {/* Org Switcher */}
          <div className="p-4 border-b border-sidebar-border">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full justify-between bg-sidebar-accent hover:bg-sidebar-accent/80"
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground font-semibold text-sm">
                      {orgName.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex flex-col items-start overflow-hidden">
                      <span className="text-sm font-medium truncate w-full text-left">
                        {orgName}
                      </span>
                      {currentOrg?.role && (
                        <span className="text-xs text-muted-foreground capitalize">{currentOrg.role}</span>
                      )}
                    </div>
                  </div>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>Organizations</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {organizations.length === 0 && (
                  <DropdownMenuItem disabled>
                    <span className="text-sm text-muted-foreground">No organizations</span>
                  </DropdownMenuItem>
                )}
                {organizations.map((org) => (
                  <DropdownMenuItem
                    key={org.id}
                    onClick={() => setSelectedOrgId(org.id)}
                    className={cn(
                      "cursor-pointer",
                      currentOrg?.id === org.id && "bg-accent"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex h-6 w-6 items-center justify-center rounded bg-primary text-primary-foreground font-semibold text-xs">
                        {org.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">{org.name}</span>
                        <span className="text-xs text-muted-foreground capitalize">{org.role}</span>
                      </div>
                    </div>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem className="cursor-pointer">
                  <Plus className="h-4 w-4 mr-2" />
                  Create Organization
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer">
                  <Plus className="h-4 w-4 mr-2" />
                  Join Organization
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
            {navigation.map((item) => (
              <Link
                key={item.name}
                href={item.href}
                onClick={onClose}
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
            <UserMenu onBeforeLogout={onClose} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
