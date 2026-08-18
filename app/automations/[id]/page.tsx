"use client"

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, RefreshCw, Workflow } from 'lucide-react'
import { toast } from 'sonner'
import { Sidebar } from '@/components/sidebar'
import { DashboardHeader } from '@/components/dashboard-header'
import { AutomationEditor } from '@/components/automations/automation-editor'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { getAutomation, type AutomationRecord } from '@/lib/api/automations.api'

export default function AutomationDetailPage() {
  const router = useRouter()
  const params = useParams()
  const automationId = params.id as string
  const [automation, setAutomation] = useState<AutomationRecord | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  async function loadAutomation() {
    setIsLoading(true)
    try {
      setAutomation(await getAutomation(automationId))
    } catch (error: any) {
      toast.error(error?.message || 'Failed to load automation')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadAutomation()
  }, [automationId])

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex w-full flex-1 flex-col overflow-hidden">
        <DashboardHeader />
        <main className="flex-1 overflow-y-auto">
          <div className="border-b border-border bg-card px-4 py-3 lg:px-8">
            <div className="flex items-center gap-2 lg:gap-4">
              <Button
                variant="ghost"
                size="sm"
                aria-label="Back"
                onClick={() => router.push('/automations')}
                className="text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="flex items-center gap-2 overflow-hidden">
                <Workflow className="h-4 w-4 shrink-0 text-primary" />
                <span className="truncate text-sm font-medium text-foreground">
                  {automation?.name || automationId}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={loadAutomation}
                className="ml-auto text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="px-4 py-6 lg:px-8 lg:py-8">
            {isLoading ? (
              <Card>
                <CardContent className="flex items-center justify-center py-12">
                  <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
                </CardContent>
              </Card>
            ) : automation ? (
              <AutomationEditor
                automation={automation}
                onAutomationChange={setAutomation}
              />
            ) : (
              <Card>
                <CardContent className="flex min-h-[24rem] items-center justify-center text-sm text-muted-foreground">
                  Automation not found.
                </CardContent>
              </Card>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
