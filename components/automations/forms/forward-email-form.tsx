"use client"

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type { ActionNodeConfig } from '@/lib/automations/types'

export function ForwardEmailForm({
  node,
  onChange,
}: {
  node: Extract<ActionNodeConfig, { actionType: 'forward_email' }>
  onChange: (node: Extract<ActionNodeConfig, { actionType: 'forward_email' }>) => void
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="forward-to">To</Label>
        <Input
          id="forward-to"
          value={node.config.to.join(', ')}
          onChange={(event) =>
            onChange({
              ...node,
              config: {
                ...node.config,
                to: event.target.value.split(',').map((item) => item.trim()).filter(Boolean),
              },
            })
          }
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="forward-note">Prepend note</Label>
        <Textarea
          id="forward-note"
          value={node.config.prependNote ?? ''}
          onChange={(event) =>
            onChange({
              ...node,
              config: {
                ...node.config,
                prependNote: event.target.value,
              },
            })
          }
        />
      </div>
      <div className="flex items-center justify-between rounded-md border p-3">
        <div>
          <div className="text-sm font-medium">Include attachments</div>
          <div className="text-xs text-muted-foreground">Attachment forwarding is best effort.</div>
        </div>
        <Switch
          checked={Boolean(node.config.includeAttachments)}
          onCheckedChange={(checked) =>
            onChange({
              ...node,
              config: {
                ...node.config,
                includeAttachments: checked,
              },
            })
          }
        />
      </div>
    </div>
  )
}
