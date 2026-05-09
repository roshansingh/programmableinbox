"use client"

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Zap } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

export function ActionNode({ data, selected }: NodeProps) {
  const nodeData = data as { label: string; subtitle: string }
  return (
    <Card className={`min-w-64 border-2 ${selected ? 'border-primary' : 'border-border'} bg-card shadow-sm`}>
      <Handle type="target" position={Position.Left} />
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Zap className="h-4 w-4" />
              {nodeData.label}
            </div>
            <p className="mt-1 text-xs text-muted-foreground break-all">{nodeData.subtitle}</p>
          </div>
          <Badge variant="secondary">Action</Badge>
        </div>
      </CardContent>
    </Card>
  )
}
