"use client"

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { GitBranchPlus, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ALL_BLOCK_KEYS } from '@/lib/automations/block-catalog'
import { NodePicker } from '@/components/automations/node-picker'
import { useAutomationEditor } from '@/components/automations/automation-editor-context'

export function ConditionNode({ id, data, selected }: NodeProps) {
  const { onPickBlock } = useAutomationEditor()
  const nodeData = data as { label: string; subtitle: string }

  return (
    <div
      className="group/node relative"
      data-selected={selected ? 'true' : 'false'}
    >
      <Card className={`min-w-64 border-2 ${selected ? 'border-primary' : 'border-border'} bg-card shadow-sm`}>
        <Handle type="target" position={Position.Left} />
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <GitBranchPlus className="h-4 w-4" />
                {nodeData.label}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{nodeData.subtitle}</p>
            </div>
            <Badge variant="secondary">Condition</Badge>
          </div>
          <div className="mt-3 flex justify-between text-[11px] text-muted-foreground">
            <span>Next</span>
          </div>
        </CardContent>
        <Handle type="source" position={Position.Right} id="next" />
      </Card>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="absolute top-1/2 -translate-y-1/2 -right-8 h-6 w-6 rounded-full opacity-0 group-hover/node:opacity-100 data-[selected=true]:opacity-100 transition-opacity"
            aria-label="Add block"
            data-testid={`add-block-${id}`}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent side="right" align="start" className="w-72 p-0">
          <NodePicker
            allowedKeys={ALL_BLOCK_KEYS}
            onPick={(key) => onPickBlock(id, key)}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
