"use client"

import { useEffect, useState } from 'react'
import { Menu, Moon, Search, Sun, X } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MobileSidebar } from "@/components/mobile-sidebar"

export interface DashboardHeaderSearch {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

interface DashboardHeaderProps {
  /** Renders a search box centered in the header. Omitted on pages that don't search anything. */
  search?: DashboardHeaderSearch
}

export function DashboardHeader({ search }: DashboardHeaderProps = {}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const { resolvedTheme, setTheme } = useTheme()

  useEffect(() => {
    setMounted(true)
  }, [])

  const isDark = resolvedTheme === 'dark'

  return (
    <>
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="px-4 py-4 lg:px-8">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                onClick={() => setMobileMenuOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </Button>

            </div>

            <div className="flex-1 flex justify-center px-2">
              {search && (
                <div className="relative w-full max-w-sm">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search.value}
                    onChange={(e) => search.onChange(e.target.value)}
                    placeholder={search.placeholder ?? 'Search'}
                    aria-label={search.placeholder ?? 'Search'}
                    className="h-9 pl-8 pr-7 text-sm"
                  />
                  {search.value && (
                    <button
                      type="button"
                      onClick={() => search.onChange('')}
                      aria-label="Clear search"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
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
            </div>
          </div>
        </div>
      </header>

      <MobileSidebar open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />
    </>
  )
}
