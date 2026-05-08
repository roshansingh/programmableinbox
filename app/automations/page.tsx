"use client"

import { useEffect, useState } from 'react'
import { Plus, Workflow } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/components/auth-provider'
import { DashboardHeader } from '@/components/dashboard-header'
import { Sidebar } from '@/components/sidebar'
import { AutomationEditor } from '@/components/automations/automation-editor'
import { AutomationList } from '@/components/automations/automation-list'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { createAutomation, getAutomation, getAutomations, type AutomationRecord } from '@/lib/api/automations.api'

export default function AutomationsPage() {
  const { organizationId } = useAuth()
  const [automations, setAutomations] = useState<AutomationRecord[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<AutomationRecord | null>(null)

  async function loadAutomations() {
    if (!organizationId) return
    try {
      const next = await getAutomations({ organizationId })
      setAutomations(next)
      setSelectedId((current) => current ?? next[0]?.id ?? null)
    } catch (error: any) {
      toast.error(error?.message || 'Failed to load automations')
    }
  }

  useEffect(() => {
    loadAutomations()
  }, [organizationId])

  useEffect(() => {
    if (!selectedId) {
      setSelected(null)
      return
    }

    getAutomation(selectedId)
      .then(setSelected)
      .catch((error: any) => {
        toast.error(error?.message || 'Failed to load automation')
      })
  }, [selectedId])

  async function handleCreate() {
    if (!organizationId) return
    try {
      const created = await createAutomation({
        organizationId,
        name: `Automation ${automations.length + 1}`,
      })
      await loadAutomations()
      setSelectedId(created.id)
      toast.success('Automation created')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to create automation')
    }
  }

  function handleAutomationChange(updated: AutomationRecord) {
    setSelected(updated)
    setSelectedId(updated.id)
    setAutomations((current) =>
      current.some((item) => item.id === updated.id)
        ? current.map((item) => (item.id === updated.id ? updated : item))
        : [updated, ...current]
    )
  }

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
                  Configure versioned email automations and render them with React Flow.
                </p>
              </div>
              <Button onClick={handleCreate}>
                <Plus className="mr-2 h-4 w-4" />
                New Automation
              </Button>
            </div>

            <div className="grid gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
              <AutomationList
                automations={automations}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
              {selected ? (
                <AutomationEditor
                  automation={selected}
                  onAutomationChange={handleAutomationChange}
                />
              ) : (
                <Card>
                  <CardContent className="flex min-h-[32rem] items-center justify-center text-sm text-muted-foreground">
                    Select an automation to inspect its graph.
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
