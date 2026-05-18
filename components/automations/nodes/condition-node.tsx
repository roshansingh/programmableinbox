"use client"

import { useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { GitBranchPlus, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { ALL_BLOCK_KEYS } from '@/lib/automations/block-catalog'
import { NodePicker } from '@/components/automations/node-picker'
import { useAutomationEditor } from '@/components/automations/automation-editor-context'

export function ConditionNode({ id, data, selected }: NodeProps) {
  const { onPickBlock } = useAutomationEditor()
  const nodeData = data as { label: string; subtitle: string }
  const [open, setOpen] = useState(false)

  return (
    <div
      className="group/node relative"
      data-selected={selected ? 'true' : 'false'}
    >
      <Card className={`min-w-64 border-2 ${selected ? 'border-primary' : 'border-border'} bg-card shadow-sm`}>
        <Handle
          type="target"
          position={Position.Left}
          className="!h-3 !w-3 !bg-background !border-2 !border-primary !rounded-full hover:!w-4 hover:!h-4 transition-all"
        />
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
        <Handle
          type="source"
          position={Position.Right}
          id="next"
          className="!h-3 !w-3 !bg-background !border-2 !border-primary !rounded-full hover:!w-4 hover:!h-4 transition-all"
        />
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
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
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a block</DialogTitle>
            <DialogDescription>Pick a block type to add as a child of this node.</DialogDescription>
          </DialogHeader>
          <NodePicker
            allowedKeys={ALL_BLOCK_KEYS}
            onPick={(key) => {
              onPickBlock(id, key)
              setOpen(false)
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
