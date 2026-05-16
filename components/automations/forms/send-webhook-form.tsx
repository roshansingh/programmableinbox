"use client"

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { ActionNodeConfig } from '@/lib/automations/types'

export function SendWebhookForm({
  node,
  onChange,
}: {
  node: Extract<ActionNodeConfig, { actionType: 'send_webhook' }>
  onChange: (node: Extract<ActionNodeConfig, { actionType: 'send_webhook' }>) => void
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="webhook-url">URL</Label>
        <Input
          id="webhook-url"
          value={node.config.url}
          onChange={(event) =>
            onChange({
              ...node,
              config: {
                ...node.config,
                url: event.target.value,
              },
            })
          }
        />
      </div>
      <div className="space-y-2">
        <Label>Method</Label>
        <Select
          value={node.config.method ?? 'POST'}
          onValueChange={(value: 'POST' | 'PUT') =>
            onChange({
              ...node,
              config: {
                ...node.config,
                method: value,
              },
            })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="POST">POST</SelectItem>
            <SelectItem value="PUT">PUT</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="webhook-body">Body template</Label>
        <Textarea
          id="webhook-body"
          value={node.config.bodyTemplate ?? ''}
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
    </div>
  )
}
