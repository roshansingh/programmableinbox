"use client"

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { GitBranchPlus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

export function ConditionNode({ data, selected }: NodeProps) {
  const nodeData = data as { label: string; subtitle: string }
  return (
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
  )
}
