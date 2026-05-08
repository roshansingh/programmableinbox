"use client"

import { GitBranch, Workflow } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { AutomationRecord } from '@/lib/api/automations.api'

export function AutomationList({
  automations,
  selectedId,
  onSelect,
}: {
  automations: AutomationRecord[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <Card className="min-h-[32rem]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Workflow className="h-4 w-4" />
          Automations
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <ScrollArea className="h-[40rem]">
          <div className="space-y-3 px-6 pb-6">
            {automations.map((automation) => (
              <button
                key={automation.id}
                type="button"
                onClick={() => onSelect(automation.id)}
                className={cn(
                  'w-full rounded-xl border p-4 text-left transition-colors hover:bg-accent/50',
                  selectedId === automation.id ? 'border-primary bg-accent/60' : 'border-border'
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{automation.name}</div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {automation.description || 'No description'}
                    </p>
                  </div>
                  <Badge variant="secondary">{automation.status}</Badge>
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <GitBranch className="h-3.5 w-3.5" />
                  Revision {automation.activeRevisionNumber ?? 'draft'}
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
