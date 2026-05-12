import type { Node } from '@xyflow/react'
import { compileAutomationGraph } from '@/lib/automations/graph'
export { validateAutomationGraph } from '@/lib/automations/validation'
import type {
  ActionNodeConfig,
  AutomationConfig,
  AutomationLayout,
  AutomationNodeConfig,
  AutomationFlowNode,
  ConditionExprV1,
  ConditionNodeConfigV1,
} from '@/lib/automations/types'
import { blockCatalog, type BlockKey } from '@/lib/automations/block-catalog'

export function compileEditorGraph(config: AutomationConfig, layout: AutomationLayout) {
  const graph = compileAutomationGraph(config, layout)
  return {
    nodes: graph.nodes as Node[],
    edges: graph.edges,
  }
}

export function updateLayoutFromNodes(layout: AutomationLayout, nodes: Node[]): AutomationLayout {
  return {
    ...layout,
    positions: Object.fromEntries(
      nodes.map((node) => [node.id, { x: node.position.x, y: node.position.y }])
    ),
  }
}

export function updateConfigNode(
  config: AutomationConfig,
  nodeId: string,
  updater: (node: AutomationNodeConfig) => AutomationNodeConfig
): AutomationConfig {
  const nodes = config.nodes.map((node) => (node.id === nodeId ? updater(node) : node))
  const trigger = nodes.find((node) => node.id === config.trigger.id && node.type === 'trigger')
  if (!trigger || trigger.type !== 'trigger') return config

  return {
    ...config,
    trigger,
    nodes,
  }
}

export function updateConditionConfig(
  config: AutomationConfig,
  nodeId: string,
  condition: ConditionExprV1
) {
  return updateConfigNode(config, nodeId, (node) => {
    if (node.type !== 'condition') return node
    return {
      ...node,
      config: condition,
    } satisfies ConditionNodeConfigV1
  })
}

export function updateActionConfig(
  config: AutomationConfig,
  nodeId: string,
  updater: (node: ActionNodeConfig) => ActionNodeConfig
) {
  return updateConfigNode(config, nodeId, (node) => {
    if (node.type !== 'action') return node
    return updater(node)
  })
}

export function getConfigNode(config: AutomationConfig, nodeId: string) {
  return config.nodes.find((node) => node.id === nodeId) ?? null
}

export function summarizeCondition(condition: ConditionExprV1): string {
  if (condition.type === 'predicate') {
    if (condition.field === 'header') {
      return `${condition.headerName ?? 'header'} ${condition.operator}`
    }
    return `${condition.field} ${condition.operator}`
  }

  return `${condition.groupOperator.toUpperCase()} ${condition.children.length} rule${condition.children.length === 1 ? '' : 's'}`
}

function createEdge(config: AutomationConfig, sourceNodeId: string, targetNodeId: string) {
  let nextIndex = config.edges.length + 1
  let edgeId = `edge_${sourceNodeId}_${targetNodeId}_${nextIndex}`

  while (config.edges.some((edge) => edge.id === edgeId)) {
    nextIndex += 1
    edgeId = `edge_${sourceNodeId}_${targetNodeId}_${nextIndex}`
  }

  return {
    id: edgeId,
    type: 'edge' as const,
    version: 1 as const,
    sourceNodeId,
    targetNodeId,
    sourceHandle: 'next' as const,
  }
}

function createNodeId(config: AutomationConfig, nodeKind: 'condition' | 'action') {
  const prefix = nodeKind === 'condition' ? 'condition' : 'action'
  let nextIndex = config.nodes.filter((node) => node.type === nodeKind).length + 1

  while (config.nodes.some((node) => node.id === `${prefix}_${nextIndex}`)) {
    nextIndex += 1
  }

  return `${prefix}_${nextIndex}`
}

function getOutgoingEdges(edges: AutomationConfig['edges']) {
  const outgoing = new Map<string, AutomationConfig['edges']>()

  for (const edge of edges) {
    outgoing.set(edge.sourceNodeId, [...(outgoing.get(edge.sourceNodeId) ?? []), edge])
  }

  return outgoing
}

function getReachableNodeIds(config: AutomationConfig, edges = config.edges) {
  const outgoing = getOutgoingEdges(edges)
  const reachable = new Set<string>()
  const queue = [config.trigger.id]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || reachable.has(current)) continue
    reachable.add(current)
    for (const edge of outgoing.get(current) ?? []) {
      queue.push(edge.targetNodeId)
    }
  }

  return reachable
}

function canConnect(
  config: AutomationConfig,
  params: { sourceNodeId: string; targetNodeId: string; ignoreEdgeId?: string }
) {
  const sourceNode = config.nodes.find((node) => node.id === params.sourceNodeId)
  const targetNode = config.nodes.find((node) => node.id === params.targetNodeId)

  if (!sourceNode || !targetNode) return false
  if (params.sourceNodeId === params.targetNodeId) return false
  if (sourceNode.type === 'action') return false
  if (targetNode.type === 'trigger') return false

  const duplicateExists = config.edges.some(
    (edge) =>
      edge.id !== params.ignoreEdgeId &&
      edge.sourceNodeId === params.sourceNodeId &&
      edge.targetNodeId === params.targetNodeId &&
      (edge.sourceHandle ?? 'next') === 'next'
  )

  if (duplicateExists) return false

  return (
    (sourceNode.type === 'trigger' && (targetNode.type === 'condition' || targetNode.type === 'action')) ||
    (sourceNode.type === 'condition' && (targetNode.type === 'condition' || targetNode.type === 'action'))
  )
}

export function addChildNode(
  config: AutomationConfig,
  params: { sourceNodeId: string; key: BlockKey }
): { config: AutomationConfig; newNodeId: string | null } {
  const sourceNode = config.nodes.find((node) => node.id === params.sourceNodeId)
  if (!sourceNode || sourceNode.type === 'action') {
    return { config, newNodeId: null }
  }

  const entry = blockCatalog[params.key]
  const nodeKind = entry.group === 'logic' ? 'condition' : 'action'
  const nodeId = createNodeId(config, nodeKind)
  const nextNode = entry.createNode(nodeId)

  return {
    config: {
      ...config,
      nodes: [...config.nodes, nextNode],
      edges: [...config.edges, createEdge(config, params.sourceNodeId, nodeId)],
    },
    newNodeId: nodeId,
  }
}

export function addFreeNode(
  config: AutomationConfig,
  layout: AutomationLayout,
  params: { key: BlockKey; position: { x: number; y: number } }
): { config: AutomationConfig; layout: AutomationLayout; newNodeId: string } {
  const entry = blockCatalog[params.key]
  const nodeKind = entry.group === 'logic' ? 'condition' : 'action'
  const nodeId = createNodeId(config, nodeKind)
  const nextNode = entry.createNode(nodeId)

  return {
    config: {
      ...config,
      nodes: [...config.nodes, nextNode],
    },
    layout: {
      ...layout,
      positions: {
        ...layout.positions,
        [nodeId]: { x: params.position.x, y: params.position.y },
      },
    },
    newNodeId: nodeId,
  }
}

export function connectNodes(
  config: AutomationConfig,
  params: { sourceNodeId: string; targetNodeId: string }
): AutomationConfig {
  if (!canConnect(config, params)) {
    return config
  }

  return {
    ...config,
    edges: [...config.edges, createEdge(config, params.sourceNodeId, params.targetNodeId)],
  }
}

export function deleteNodeCascade(config: AutomationConfig, nodeId: string): AutomationConfig {
  if (nodeId === config.trigger.id || !config.nodes.some((node) => node.id === nodeId)) {
    return config
  }

  const filteredNodes = config.nodes.filter((node) => node.id !== nodeId)
  const filteredEdges = config.edges.filter(
    (edge) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId
  )
  const reachable = getReachableNodeIds(config, filteredEdges)

  return {
    ...config,
    nodes: filteredNodes.filter((node) => reachable.has(node.id)),
    edges: filteredEdges.filter(
      (edge) => reachable.has(edge.sourceNodeId) && reachable.has(edge.targetNodeId)
    ),
  }
}
