"use client"

import { useEffect, useMemo, useState } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  type Node,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Copy, Play, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  dryRunAutomation,
  duplicateAutomation,
  updateAutomation,
  type AutomationRecord,
} from '@/lib/api/automations.api'
import type { AutomationLayout } from '@/lib/automations/types'
import { RunHistoryPanel } from './run-history-panel'

function AutomationEditorInner({
  automation,
  onAutomationChange,
}: {
  automation: AutomationRecord
  onAutomationChange: (automation: AutomationRecord) => void
}) {
  const [nodes, setNodes] = useState<Node[]>(automation.nodes as Node[])
  const [isSaving, setIsSaving] = useState(false)
  const [isDryRunning, setIsDryRunning] = useState(false)
  const [isDuplicating, setIsDuplicating] = useState(false)

  useEffect(() => {
    setNodes(automation.nodes as Node[])
  }, [automation.id, automation.updatedAt])

  const edges = automation.edges

  const serializedConfig = useMemo(
    () => JSON.stringify(automation.config, null, 2),
    [automation.config]
  )
  const serializedLayout = useMemo(
    () => JSON.stringify(automation.layout, null, 2),
    [automation.layout]
  )

  function onNodesChange(changes: NodeChange[]) {
    setNodes((current) => applyNodeChanges(changes, current) as Node[])
  }

  async function saveLayout() {
    setIsSaving(true)
    try {
      const positions = Object.fromEntries(
        nodes.map((node) => [node.id, { x: node.position.x, y: node.position.y }])
      )

      const nextLayout: AutomationLayout = {
        type: 'react_flow_layout',
        version: 1,
        positions,
        viewport: automation.layout?.viewport,
      }

      const updated = await updateAutomation(automation.id, { layout: nextLayout })
      onAutomationChange(updated)
      toast.success('Layout saved')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to save layout')
    } finally {
      setIsSaving(false)
    }
  }

  async function runDry() {
    setIsDryRunning(true)
    try {
      const results = await dryRunAutomation(automation.id, 10)
      toast.success(`Dry run completed for ${results.length} message(s)`)
    } catch (error: any) {
      toast.error(error?.message || 'Dry run failed')
    } finally {
      setIsDryRunning(false)
    }
  }

  async function duplicate() {
    setIsDuplicating(true)
    try {
      const duplicated = await duplicateAutomation(automation.id)
      onAutomationChange(duplicated)
      toast.success('Automation duplicated')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to duplicate automation')
    } finally {
      setIsDuplicating(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-2xl">{automation.name}</CardTitle>
            <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="secondary">{automation.status}</Badge>
              <span>Revision {automation.activeRevisionNumber ?? 'draft'}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={duplicate} disabled={isDuplicating}>
              <Copy className="mr-2 h-4 w-4" />
              Duplicate
            </Button>
            <Button variant="outline" onClick={runDry} disabled={isDryRunning}>
              <Play className="mr-2 h-4 w-4" />
              Dry Run
            </Button>
            <Button onClick={saveLayout} disabled={isSaving}>
              <Save className="mr-2 h-4 w-4" />
              Save Layout
            </Button>
          </div>
        </CardHeader>
      </Card>

      <Tabs defaultValue="flow">
        <TabsList>
          <TabsTrigger value="flow">Flow</TabsTrigger>
          <TabsTrigger value="config">Config</TabsTrigger>
          <TabsTrigger value="layout">Layout</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
        </TabsList>

        <TabsContent value="flow">
          <Card className="overflow-hidden">
            <CardContent className="h-[34rem] p-0">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                fitView
              >
                <Background />
                <MiniMap />
                <Controls />
              </ReactFlow>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="config">
          <Textarea readOnly value={serializedConfig} className="min-h-[28rem] font-mono text-xs" />
        </TabsContent>

        <TabsContent value="layout">
          <Textarea readOnly value={serializedLayout} className="min-h-[28rem] font-mono text-xs" />
        </TabsContent>

        <TabsContent value="runs">
          <RunHistoryPanel automationId={automation.id} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export function AutomationEditor(props: {
  automation: AutomationRecord
  onAutomationChange: (automation: AutomationRecord) => void
}) {
  return (
    <ReactFlowProvider>
      <AutomationEditorInner {...props} />
    </ReactFlowProvider>
  )
}
