"use client"

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ActionNodeConfig } from '@/lib/automations/types'

export function AddTagForm({
  node,
  onChange,
}: {
  node: Extract<ActionNodeConfig, { actionType: 'add_tag' }>
  onChange: (node: Extract<ActionNodeConfig, { actionType: 'add_tag' }>) => void
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="tag-list">Tags</Label>
      <Input
        id="tag-list"
        value={node.config.tags.join(', ')}
        onChange={(event) =>
          onChange({
            ...node,
            config: {
              ...node.config,
              tags: event.target.value.split(',').map((item) => item.trim()).filter(Boolean),
            },
          })
        }
      />
    </div>
  )
}
