"use client"

import { useEffect, useState } from 'react'
import { Menu, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from "@/components/ui/button"
import { MobileSidebar } from "@/components/mobile-sidebar"

export function DashboardHeader() {
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
            </div>
          </div>
        </div>
      </header>

      <MobileSidebar open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />
    </>
  )
}
