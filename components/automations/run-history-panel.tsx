"use client"

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, Loader2, RotateCcw, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  getAutomationRuns,
  replayAutomationRun,
  type AutomationReplayMode,
  type AutomationRunRecord,
} from '@/lib/api/automations.api'

const SUBJECT_PREVIEW_LENGTH = 60

function truncateSubject(subject: string): string {
  if (subject.length <= SUBJECT_PREVIEW_LENGTH) return subject
  return `${subject.slice(0, SUBJECT_PREVIEW_LENGTH).trimEnd()}…`
}

export function RunHistoryPanel({ automationId }: { automationId: string }) {
  const [runs, setRuns] = useState<AutomationRunRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [replayingId, setReplayingId] = useState<string | null>(null)

  async function loadRuns() {
    setIsLoading(true)
    try {
      setRuns(await getAutomationRuns(automationId))
    } catch (error: any) {
      toast.error(error?.message || 'Failed to load automation runs')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadRuns()
  }, [automationId])

  async function handleReplay(runId: string, mode: AutomationReplayMode) {
    // A live replay re-sends real webhooks / emails, so it always goes through
    // an explicit confirmation step before the (separately confirmed) API call.
    if (
      mode === 'live' &&
      !window.confirm(
        'Replay this run for real? Webhooks, forwarded emails and auto-replies will be sent again.'
      )
    ) {
      return
    }

    setReplayingId(runId)
    try {
      await replayAutomationRun(automationId, runId, mode)
      toast.success(mode === 'live' ? 'Run replayed (live)' : 'Run replayed (dry run)')
      await loadRuns()
    } catch (error: any) {
      toast.error(error?.message || 'Failed to replay run')
    } finally {
      setReplayingId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Run History</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading runs
          </div>
        ) : runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No runs yet.</p>
        ) : (
          runs.map((run) => (
            <div key={run.id} className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{run.triggerType}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(run.startedAt).toLocaleString()}
                  </div>
                  {run.emailMessage && (
                    <Link
                      href={`/emails/${run.emailMessage.inboxEmailAddressId}?threadId=${run.emailMessage.threadId}&messageId=${run.emailMessage.id}`}
                      className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
                    >
                      <span className="min-w-0 truncate">
                        From {run.emailMessage.from} · {truncateSubject(run.emailMessage.subject)}
                      </span>
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </Link>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{run.status}</Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Replay as a dry run (no webhooks or emails sent)"
                    aria-label="Replay as dry run"
                    onClick={() => handleReplay(run.id, 'dry_run')}
                    disabled={replayingId === run.id}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Replay for real — re-sends webhooks and emails"
                    aria-label="Replay live"
                    onClick={() => handleReplay(run.id, 'live')}
                    disabled={replayingId === run.id}
                  >
                    <Zap className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}
