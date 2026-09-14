"use client"

import Link from "next/link"
import { usePathname } from 'next/navigation'
import { Inbox, Mail, Phone, Settings, Workflow, CreditCard, LifeBuoy } from 'lucide-react'
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
 * `COMMERCIAL_ENABLED=true` and Stripe is configured, so this is the whole gate.
 */
const BILLING_ITEM = { name: "Billing", icon: CreditCard, href: "/billing", current: false }

const SUPPORT_ITEM = { name: "Support", icon: LifeBuoy, href: "/support", current: false }

interface MobileSidebarProps {
  open: boolean
  onClose: () => void
}

export function MobileSidebar({ open, onClose }: MobileSidebarProps) {
  const pathname = usePathname()
  const { user, plan } = useAuth()
  const currentOrg = user?.organizations?.[0]
  const orgName = currentOrg?.name ?? "Organization"
  const orgInitial = orgName.charAt(0).toUpperCase()
  const navigation = [
    ...BASE_NAVIGATION,
    ...(plan ? [BILLING_ITEM] : []),
    SETTINGS_ITEM,
    ...(plan ? [SUPPORT_ITEM] : []),
  ]

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="left" className="p-0 w-64">
        <div className="flex flex-col h-full bg-sidebar">
          {/* Org Display — matches the static block in sidebar.tsx (desktop). */}
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
