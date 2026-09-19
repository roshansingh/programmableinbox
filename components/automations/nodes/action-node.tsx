"use client"

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Zap } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { nodeCardClasses } from './node-styles'

export function ActionNode({ data, selected }: NodeProps) {
  const nodeData = data as { label: string; subtitle: string; issues?: string[] }
  const issues = nodeData.issues ?? []
  return (
    <Card
      title={issues.length > 0 ? issues.join('\n') : undefined}
      className={`min-w-64 ${nodeCardClasses({ selected: !!selected, invalid: issues.length > 0 })} bg-card shadow-sm`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !bg-background !border-2 !border-primary !rounded-full hover:!w-4 hover:!h-4 transition-all"
      />
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
