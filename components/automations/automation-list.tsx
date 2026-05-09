"use client"

import { useEffect, useState } from 'react'
import type { MouseEvent } from 'react'
import { useRouter } from 'next/navigation'
import { GitBranch, Loader2, Play, Square, Trash2, Workflow } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/components/auth-provider'
import {
  createAutomation,
  deleteAutomation,
  getAutomations,
  updateAutomation,
  type AutomationRecord,
} from '@/lib/api/automations.api'
import { Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

export function AutomationList() {
  const router = useRouter()
  const { organizationId } = useAuth()
  const [automations, setAutomations] = useState<AutomationRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [pendingAutomationId, setPendingAutomationId] = useState<string | null>(null)

  async function loadAutomations() {
    if (!organizationId) return
    setIsLoading(true)
    try {
      setAutomations(await getAutomations({ organizationId }))
    } catch (error: any) {
      toast.error(error?.message || 'Failed to load automations')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadAutomations()
  }, [organizationId])

  async function handleCreate() {
    if (!organizationId) return
    try {
      const created = await createAutomation({
        organizationId,
        name: `Automation ${automations.length + 1}`,
      })
      toast.success('Automation created')
      router.push(`/automations/${created.id}`)
    } catch (error: any) {
      toast.error(error?.message || 'Failed to create automation')
    }
  }

  async function handleToggleStatus(
    event: MouseEvent<HTMLButtonElement>,
    automation: AutomationRecord
  ) {
    event.stopPropagation()
    setPendingAutomationId(automation.id)
    try {
      const updated = await updateAutomation(automation.id, { isActive: !automation.isActive })
      setAutomations((current) =>
        current.map((item) => (item.id === automation.id ? updated : item))
      )
      toast.success(updated.isActive ? 'Automation activated' : 'Automation moved to draft')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update automation')
    } finally {
      setPendingAutomationId(null)
    }
  }

  async function handleDelete(
    event: MouseEvent<HTMLButtonElement>,
    automation: AutomationRecord
  ) {
    event.stopPropagation()
    if (!window.confirm(`Delete automation "${automation.name}"?`)) {
      return
    }

    setPendingAutomationId(automation.id)
    try {
      await deleteAutomation(automation.id)
      setAutomations((current) => current.filter((item) => item.id !== automation.id))
      toast.success('Automation deleted')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to delete automation')
    } finally {
      setPendingAutomationId(null)
    }
  }

  if (isLoading) {
    return (
      <Card className="bg-card">
        <CardContent className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="bg-card">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Workflow className="h-4 w-4" />
              Automations
            </CardTitle>
            <CardDescription>Manage automation workflows for this account</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button onClick={loadAutomations} variant="outline" size="sm">
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button onClick={handleCreate} size="sm">
              <Plus className="mr-2 h-4 w-4" />
              Create
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {automations.length === 0 ? (
          <div className="py-12 text-center">
            <Workflow className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="mb-2 text-lg font-semibold">No automations</h3>
            <p className="mb-4 text-sm text-muted-foreground">
              Create your first automation to start routing incoming email.
            </p>
            <Button onClick={handleCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Create Automation
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {automations.map((automation) => (
              <div
                key={automation.id}
                onClick={() => router.push(`/automations/${automation.id}`)}
                className="flex cursor-pointer items-center justify-between rounded-lg border border-border bg-muted/30 p-4 transition-colors hover:bg-muted/50"
              >
                <div className="flex flex-1 items-center gap-3">
                  <div className="rounded-md bg-primary/10 p-2">
                    <Workflow className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{automation.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {automation.description || 'No description'}
                    </p>
                    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <GitBranch className="h-3.5 w-3.5" />
                      Revision {automation.activeRevisionNumber ?? 'draft'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={automation.isActive ? 'outline' : 'secondary'}
                    className={
                      automation.isActive
                        ? 'border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300'
                        : undefined
                    }
                  >
                    {automation.status}
                  </Badge>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={
                      pendingAutomationId === automation.id ||
                      (!automation.isActive && !automation.canStart)
                    }
                    onClick={(event) => handleToggleStatus(event, automation)}
                  >
                    {pendingAutomationId === automation.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : automation.isActive ? (
                      <Square className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    {automation.isActive ? 'Stop' : 'Start'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={pendingAutomationId === automation.id}
                    onClick={(event) => handleDelete(event, automation)}
                  >
                    {pendingAutomationId === automation.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
