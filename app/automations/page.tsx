"use client"

import { Workflow } from 'lucide-react'
import { DashboardHeader } from '@/components/dashboard-header'
import { Sidebar } from '@/components/sidebar'
import { AutomationList } from '@/components/automations/automation-list'

export default function AutomationsPage() {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex w-full flex-1 flex-col overflow-hidden">
        <DashboardHeader />
        <main className="flex-1 overflow-y-auto px-4 py-6 lg:px-8 lg:py-8">
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight lg:text-3xl">
                  <Workflow className="h-7 w-7" />
                  Automations
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  View and manage all automations for this account.
                </p>
              </div>
            </div>
            <AutomationList />
          </div>
        </main>
      </div>
    </div>
  )
}
