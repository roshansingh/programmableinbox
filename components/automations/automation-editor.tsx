"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Node,
  type NodeChange,
  type Edge,
  type NodeMouseHandler,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Copy, Play, Save, Square } from 'lucide-react'
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
import type {
  ActionNodeConfig,
  AutomationConfig,
  AutomationLayout,
  ConditionExprV1,
} from '@/lib/automations/types'
import { ALL_BLOCK_KEYS, type BlockKey } from '@/lib/automations/block-catalog'
import {
  addChildNode,
  addFreeNode,
  compileEditorGraph,
  connectNodes,
  deleteNodeCascade,
  getConfigNode,
  updateActionConfig,
  updateConditionConfig,
  updateLayoutFromNodes,
  validateAutomationGraph,
} from './editor-state'
import { TriggerNode } from './nodes/trigger-node'
import { ConditionNode } from './nodes/condition-node'
import { ActionNode } from './nodes/action-node'
import { RunHistoryPanel } from './run-history-panel'
import { NodeConfigSheet } from './node-config-sheet'
import { AUTOMATION_BLOCK_MIME, PaletteSidebar } from './palette-sidebar'
import { AutomationEditorContextProvider } from './automation-editor-context'

const nodeTypes: NodeTypes = {
  triggerNode: TriggerNode,
  conditionNode: ConditionNode,
  actionNode: ActionNode,
}

function AutomationEditorInner({
  automation,
  onAutomationChange,
}: {
  automation: AutomationRecord
  onAutomationChange: (automation: AutomationRecord) => void
}) {
  const initialConfig = automation.config as AutomationConfig
  const initialLayout = automation.layout as AutomationLayout
  const initialGraph = compileEditorGraph(initialConfig, initialLayout)
  const [config, setConfig] = useState<AutomationConfig>(initialConfig)
  const [layout, setLayout] = useState<AutomationLayout>(initialLayout)
  const [nodes, setNodes] = useState<Node[]>(initialGraph.nodes)
  const [edges, setEdges] = useState<Edge[]>(initialGraph.edges as Edge[])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [configDirty, setConfigDirty] = useState(false)
  const [layoutDirty, setLayoutDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isSavingLayout, setIsSavingLayout] = useState(false)
  const [isDryRunning, setIsDryRunning] = useState(false)
  const [isDuplicating, setIsDuplicating] = useState(false)

  const reactFlow = useReactFlow()

  useEffect(() => {
    const nextConfig = automation.config as AutomationConfig
    const nextLayout = automation.layout as AutomationLayout
    const graph = compileEditorGraph(nextConfig, nextLayout)
    setConfig(nextConfig)
    setLayout(nextLayout)
    setNodes(graph.nodes)
    setEdges(graph.edges as Edge[])
    setConfigDirty(false)
    setLayoutDirty(false)
    setSelectedNodeId(null)
  }, [automation.id, automation.updatedAt])

  const serializedConfig = useMemo(
    () => JSON.stringify(config, null, 2),
    [config]
  )
  const serializedLayout = useMemo(
    () => JSON.stringify(layout, null, 2),
    [layout]
  )
  const selectedNode = useMemo(
    () => (selectedNodeId ? getConfigNode(config, selectedNodeId) : null),
    [config, selectedNodeId]
  )
  const displayedNodes = useMemo(
    () => nodes.map((n) => ({ ...n, selected: n.id === selectedNodeId })),
    [nodes, selectedNodeId]
  )
  const validation = useMemo(() => validateAutomationGraph(config), [config])

  function onNodesChange(changes: NodeChange[]) {
    setNodes((current) => {
      const next = applyNodeChanges(changes, current) as Node[]
      const changedPositions = changes.some((change) => change.type === 'position' || change.type === 'dimensions')
      if (changedPositions) {
        setLayout(updateLayoutFromNodes(layout, next))
        setLayoutDirty(true)
      }
      return next
    })
  }

  const reconcile = useCallback((nextConfig: AutomationConfig, nextLayout: AutomationLayout) => {
    const graph = compileEditorGraph(nextConfig, nextLayout)
    setConfig(nextConfig)
    setLayout(nextLayout)
    setNodes(graph.nodes)
    setEdges(graph.edges as Edge[])
  }, [])

  const handleNodeClick: NodeMouseHandler = (_, node) => {
    setSelectedNodeId(node.id)
  }

  const handlePickBlock = useCallback(
    (sourceNodeId: string, key: BlockKey) => {
      const result = addChildNode(config, { sourceNodeId, key })
      if (!result.newNodeId) return
      reconcile(result.config, layout)
      setConfigDirty(true)
    },
    [config, layout, reconcile]
  )

  const clearSelection = useCallback(() => {
    setSelectedNodeId(null)
    setNodes((current) => current.map((n) => ({ ...n, selected: false })))
  }, [])

  const handleDeleteBlock = useCallback(
    (nodeId: string) => {
      const nextConfig = deleteNodeCascade(config, nodeId)
      if (nextConfig === config) return
      reconcile(nextConfig, layout)
      clearSelection()
      setConfigDirty(true)
    },
    [config, layout, reconcile, clearSelection]
  )

  const handleNodesDelete = useCallback(
    (deleted: Node[]) => {
      if (deleted.length === 0) return
      let nextConfig = config
      for (const node of deleted) {
        nextConfig = deleteNodeCascade(nextConfig, node.id)
      }
      if (nextConfig === config) return
      reconcile(nextConfig, layout)
      clearSelection()
      setConfigDirty(true)
    },
    [config, layout, reconcile, clearSelection]
  )

  const handleSheetOpenChange = useCallback(
    (open: boolean) => {
      if (open) return
      clearSelection()
    },
    [clearSelection]
  )

  const handleEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      if (deleted.length === 0) return
      const ids = new Set(deleted.map((e) => e.id))
      const nextConfig = {
        ...config,
        edges: config.edges.filter((e) => !ids.has(e.id)),
      }
      reconcile(nextConfig, layout)
      setConfigDirty(true)
    },
    [config, layout, reconcile]
  )

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes(AUTOMATION_BLOCK_MIME)) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      const rawKey = event.dataTransfer.getData(AUTOMATION_BLOCK_MIME)
      if (!rawKey || !ALL_BLOCK_KEYS.includes(rawKey as BlockKey)) return
      const key = rawKey as BlockKey

      const target = event.target as HTMLElement | null
      const nodeEl = target?.closest('.react-flow__node') as HTMLElement | null
      const targetNodeId = nodeEl?.getAttribute('data-id') ?? null

      if (targetNodeId) {
        const sourceNode = getConfigNode(config, targetNodeId)
        if (!sourceNode) return
        if (sourceNode.type === 'action') {
          toast.error('Action blocks cannot have children')
          return
        }
        handlePickBlock(targetNodeId, key)
        return
      }

      const position = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })
      const result = addFreeNode(config, layout, { key, position })
      if (!result.newNodeId) return
      reconcile(result.config, result.layout)
      setConfigDirty(true)
      setLayoutDirty(true)
    },
    [config, layout, reactFlow, handlePickBlock, reconcile]
  )

  function isValidConnection(connection: Connection) {
    const source = connection.source ? getConfigNode(config, connection.source) : null
    const target = connection.target ? getConfigNode(config, connection.target) : null
    if (!source || !target) return false
    if (source.id === target.id) return false
    if (target.type === 'trigger') return false
    if (source.type === 'action') return false
    if (
      config.edges.some(
        (edge) =>
          edge.sourceNodeId === source.id &&
          edge.targetNodeId === target.id &&
          (edge.sourceHandle ?? 'next') === 'next'
      )
    ) {
      return false
    }
    if (source.type === 'trigger') {
      return target.type === 'condition' || target.type === 'action'
    }
    return target.type === 'condition' || target.type === 'action'
  }

  function handleConnect(connection: Connection) {
    if (!connection.source || !connection.target) return
    const nextConfig = connectNodes(config, {
      sourceNodeId: connection.source,
      targetNodeId: connection.target,
    })
    if (nextConfig === config) return
    reconcile(nextConfig, layout)
    setConfigDirty(true)
  }

  async function saveLayoutOnly() {
    setIsSavingLayout(true)
    try {
      const latestLayout = updateLayoutFromNodes(layout, nodes)
      const updated = await updateAutomation(automation.id, { layout: latestLayout })
      onAutomationChange(updated)
      toast.success('Layout saved')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to save layout')
    } finally {
      setIsSavingLayout(false)
    }
  }

  async function saveAutomation() {
    setIsSaving(true)
    try {
      const latestLayout = updateLayoutFromNodes(layout, nodes)
      const updated = await updateAutomation(automation.id, {
        config,
        layout: latestLayout,
      })
      onAutomationChange(updated)
      toast.success('Automation saved')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to save automation')
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

  async function handleToggleStart() {
    if (!automation.isActive && !validation.canStart) return

    try {
      const isStarting = !automation.isActive
      const shouldSaveCurrentRevision = isStarting && (configDirty || layoutDirty)
      const latestLayout = shouldSaveCurrentRevision ? updateLayoutFromNodes(layout, nodes) : undefined
      const updated = await updateAutomation(automation.id, {
        isActive: isStarting,
        ...(shouldSaveCurrentRevision
          ? {
              config,
              layout: latestLayout!,
            }
          : {}),
      })
      onAutomationChange(updated)
      toast.success(updated.isActive ? 'Automation started' : 'Automation stopped')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update automation status')
    }
  }

  function handleConditionChange(condition: ConditionExprV1) {
    if (!selectedNodeId) return
    const nextConfig = updateConditionConfig(config, selectedNodeId, condition)
    reconcile(nextConfig, layout)
    setConfigDirty(true)
  }

  function handleActionChange(node: ActionNodeConfig) {
    const nextConfig = updateActionConfig(config, node.id, () => node)
    reconcile(nextConfig, layout)
    setConfigDirty(true)
  }

  return (
    <AutomationEditorContextProvider
      value={{ onPickBlock: handlePickBlock, onDeleteBlock: handleDeleteBlock }}
    >
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
              <Button
                variant={automation.isActive ? 'outline' : 'default'}
                disabled={isSaving || (!automation.isActive && !validation.canStart)}
                onClick={handleToggleStart}
              >
                {automation.isActive ? (
                  <Square className="mr-2 h-4 w-4" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                {automation.isActive ? 'Stop' : 'Start'}
              </Button>
              <Button variant="outline" onClick={duplicate} disabled={isDuplicating}>
                <Copy className="mr-2 h-4 w-4" />
                Duplicate
              </Button>
              <Button variant="outline" onClick={runDry} disabled={isDryRunning}>
                <Play className="mr-2 h-4 w-4" />
                Dry Run
              </Button>
              <Button variant="outline" onClick={saveLayoutOnly} disabled={isSavingLayout || !layoutDirty}>
                <Save className="mr-2 h-4 w-4" />
                Save Layout
              </Button>
              <Button
                onClick={saveAutomation}
                disabled={
                  isSaving ||
                  (!configDirty && !layoutDirty) ||
                  !validation.canStart
                }
                title={!validation.canStart ? 'Fix validation errors before saving' : undefined}
              >
                <Save className="mr-2 h-4 w-4" />
                Save Automation
              </Button>
            </div>
          </CardHeader>
        </Card>

        {validation.issues.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Validation</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {validation.issues.map((issue) => {
                  const key = `${issue.code}:${issue.nodeId ?? issue.edgeId ?? issue.message}`
                  if (issue.nodeId && config.nodes.some((n) => n.id === issue.nodeId)) {
                    const targetNodeId = issue.nodeId
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          onClick={() => setSelectedNodeId(targetNodeId)}
                          className="text-left underline-offset-2 hover:underline hover:text-foreground"
                        >
                          {issue.message}
                        </button>
                      </li>
                    )
                  }
                  return <li key={key}>{issue.message}</li>
                })}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <Tabs defaultValue="flow">
          <TabsList>
            <TabsTrigger value="flow">Flow</TabsTrigger>
            <TabsTrigger value="config">Config</TabsTrigger>
            <TabsTrigger value="layout">Layout</TabsTrigger>
            <TabsTrigger value="runs">Runs</TabsTrigger>
          </TabsList>

          <TabsContent value="flow">
            <Card className="overflow-hidden">
              <CardContent className="grid grid-cols-[192px_1fr] gap-0 p-0">
                <PaletteSidebar />
                <div
                  data-testid="canvas-drop-zone"
                  className="h-[34rem]"
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                >
                  <ReactFlow
                    nodes={displayedNodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onConnect={handleConnect}
                    onNodesDelete={handleNodesDelete}
                    onEdgesDelete={handleEdgesDelete}
                    isValidConnection={isValidConnection}
                    nodeTypes={nodeTypes}
                    nodesConnectable
                    nodesDraggable
                    elementsSelectable
                    onNodeClick={handleNodeClick}
                    onPaneClick={() => handleSheetOpenChange(false)}
                    fitView
                    fitViewOptions={{ maxZoom: 0.75, minZoom: 0.75 }}
                  >
                    <Background />
                    <Controls />
                  </ReactFlow>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="config">
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Canonical config is available for debugging, but the primary editing path is the node config sheet.
              </p>
              <Textarea readOnly value={serializedConfig} className="min-h-[28rem] font-mono text-xs" />
            </div>
          </TabsContent>

          <TabsContent value="layout">
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Layout is derived editor state and saved separately from canonical automation config.
              </p>
              <Textarea readOnly value={serializedLayout} className="min-h-[28rem] font-mono text-xs" />
            </div>
          </TabsContent>

          <TabsContent value="runs">
            <RunHistoryPanel automationId={automation.id} />
          </TabsContent>
        </Tabs>

        <NodeConfigSheet
          node={selectedNode}
          open={Boolean(selectedNode)}
          onOpenChange={handleSheetOpenChange}
          onConditionChange={handleConditionChange}
          onActionChange={handleActionChange}
        />
      </div>
    </AutomationEditorContextProvider>
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
