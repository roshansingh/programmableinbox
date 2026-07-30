"use client"

import { ChevronDown, LogOut } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAuth } from "@/components/auth-provider"
import { logout } from "@/lib/api/auth.api"
import { getUserDisplayName, getUserInitials } from "@/lib/user-display"

interface UserMenuProps {
  /** Runs before navigating away — lets the mobile sheet close itself. */
  onBeforeLogout?: () => void
}

/**
 * Signed-in user row in the nav footer, with a log out menu.
 * Shared by the desktop sidebar and the mobile sheet.
 */
export function UserMenu({ onBeforeLogout }: UserMenuProps) {
  const { user } = useAuth()

  if (!user) {
    return (
      <div className="flex items-center gap-3 px-3 py-2 animate-pulse" aria-hidden="true">
        <div className="h-8 w-8 shrink-0 rounded-full bg-muted" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3 w-24 rounded bg-muted" />
          <div className="h-2.5 w-32 rounded bg-muted" />
        </div>
      </div>
    )
  }

  const handleLogout = () => {
    onBeforeLogout?.()
    logout()
    // Full navigation rather than router.push: it guarantees no stale user
    // data survives in memory, and it sidesteps AuthGuard, which would
    // otherwise redirect to /auth/login?redirect=<current page>. Matches how
    // lib/api-client.ts handles a 401.
    window.location.href = '/auth/login'
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div className="h-8 w-8 shrink-0 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold text-sm">
          {getUserInitials(user)}
        </div>
        <div className="flex-1 overflow-hidden">
          <p className="text-sm font-medium text-sidebar-foreground truncate">
            {getUserDisplayName(user)}
          </p>
          <p className="text-xs text-muted-foreground truncate">{user.email}</p>
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-[var(--radix-dropdown-menu-trigger-width)]">
        <DropdownMenuItem
          onSelect={handleLogout}
          variant="destructive"
          className="cursor-pointer"
        >
          <LogOut className="h-4 w-4 mr-2" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
