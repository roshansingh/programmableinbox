"use client"

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { ActionNodeConfig } from '@/lib/automations/types'

export function AutoReplyForm({
  node,
  onChange,
}: {
  node: Extract<ActionNodeConfig, { actionType: 'auto_reply' }>
  onChange: (node: Extract<ActionNodeConfig, { actionType: 'auto_reply' }>) => void
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="auto-reply-subject">Subject template</Label>
        <Input
          id="auto-reply-subject"
          value={node.config.subjectTemplate}
          onChange={(event) =>
            onChange({
              ...node,
              config: {
                ...node.config,
                subjectTemplate: event.target.value,
              },
            })
          }
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="auto-reply-body">Body template</Label>
        <Textarea
          id="auto-reply-body"
          value={node.config.bodyTemplate}
          onChange={(event) =>
            onChange({
              ...node,
              config: {
                ...node.config,
                bodyTemplate: event.target.value,
              },
            })
          }
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="auto-reply-window">Throttle window hours</Label>
        <Input
          id="auto-reply-window"
          type="number"
          value={node.config.oncePerSenderWindowHours ?? 24}
          onChange={(event) =>
            onChange({
              ...node,
              config: {
                ...node.config,
                oncePerSenderWindowHours: Number(event.target.value || 24),
              },
            })
          }
        />
      </div>
    </div>
  )
}
