"use client"

import { useEffect, useState } from 'react'
import { Search, Menu, Moon, Sun, Mail } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MobileSidebar } from "@/components/mobile-sidebar"
import { useAuth } from "@/components/auth-provider"
import { getEmailInboxes } from "@/lib/api/emails.api"

export function DashboardHeader() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [inboxCount, setInboxCount] = useState<number | null>(null)
  const { resolvedTheme, setTheme } = useTheme()
  const { organizationId } = useAuth()

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!organizationId) return
    getEmailInboxes({ organizationId })
      .then((inboxes) => setInboxCount(inboxes.length))
      .catch(() => {})
  }, [organizationId])

  const isDark = resolvedTheme === 'dark'

  return (
    <>
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="px-4 py-4 lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                onClick={() => setMobileMenuOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </Button>

              <div className="flex-1 max-w-md hidden sm:block">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="search"
                    placeholder="Search emails..."
                    className="pl-9 bg-background"
                  />
                </div>
              </div>

              {inboxCount !== null && (
                <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted text-muted-foreground text-sm">
                  <Mail className="h-3.5 w-3.5" />
                  <span>{inboxCount} {inboxCount === 1 ? 'inbox' : 'inboxes'}</span>
                </div>
              )}
            </div>
            
            <div className="flex items-center gap-2">
              {mounted ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="cursor-pointer"
                  onClick={() => setTheme(isDark ? 'light' : 'dark')}
                  aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                  title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                >
                  {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="cursor-default"
                  aria-label="Theme toggle loading"
                  title="Theme toggle loading"
                  disabled
                >
                  <Moon className="h-5 w-5" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="sm:hidden">
                <Search className="h-5 w-5" />
              </Button>
              
            </div>
          </div>
        </div>
      </header>

      <MobileSidebar open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />
    </>
  )
}
