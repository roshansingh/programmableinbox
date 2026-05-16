import type {
  AutomationConfig,
  AutomationFlowEdge,
  AutomationFlowNode,
  AutomationLayout,
  AutomationNodeKind,
  AutomationNodeConfig,
} from './types'
import {
  NODE_LAYOUT_BASE_Y,
  NODE_LAYOUT_COLUMN_GAP,
  NODE_LAYOUT_ROW_GAP,
  NODE_LAYOUT_START_X,
} from './definitions'

function describeNode(node: AutomationNodeConfig): { label: string; subtitle: string } {
  if (node.type === 'trigger') {
    return { label: 'Email Received', subtitle: 'Trigger' }
  }

  if (node.type === 'condition') {
    const subtitle = node.config.type === 'condition_group' ? `${node.config.groupOperator.toUpperCase()} group` : 'Condition'
    return { label: 'Condition', subtitle }
  }

  switch (node.actionType) {
    case 'forward_email':
      return { label: 'Forward Email', subtitle: node.config.to.join(', ') }
    case 'send_webhook':
      return { label: 'Send Webhook', subtitle: node.config.url }
    case 'auto_reply':
      return { label: 'Auto Reply', subtitle: node.config.subjectTemplate }
    case 'add_tag':
      return { label: 'Add Tag', subtitle: node.config.tags.join(', ') }
  }
}

function getBranchHandles(node: AutomationNodeConfig) {
  if (node.type === 'action') return [] as const
  return ['next'] as const
}

function getNodeKind(node: AutomationNodeConfig): AutomationNodeKind {
  return node.type
}

function computeFallbackPositions(config: AutomationConfig) {
  const outgoing = new Map<string, string[]>()
  for (const edge of config.edges) {
    const list = outgoing.get(edge.sourceNodeId) ?? []
    list.push(edge.targetNodeId)
    outgoing.set(edge.sourceNodeId, list)
  }

  const depthById = new Map<string, number>()
  const queue: { id: string; depth: number }[] = [{ id: config.trigger.id, depth: 0 }]

  while (queue.length > 0) {
    const current = queue.shift()!
    if (depthById.has(current.id)) continue
    depthById.set(current.id, current.depth)
    for (const targetId of outgoing.get(current.id) ?? []) {
      if (!depthById.has(targetId)) {
        queue.push({ id: targetId, depth: current.depth + 1 })
      }
    }
  }

  const slotByDepth = new Map<number, number>()
  const positions = new Map<string, { x: number; y: number }>()

  for (const node of config.nodes) {
    const depth = depthById.get(node.id) ?? depthById.size
    const slot = slotByDepth.get(depth) ?? 0
    slotByDepth.set(depth, slot + 1)
    positions.set(node.id, {
      x: NODE_LAYOUT_START_X + depth * NODE_LAYOUT_COLUMN_GAP,
      y: NODE_LAYOUT_BASE_Y + slot * NODE_LAYOUT_ROW_GAP,
    })
  }

  return positions
}

export function compileAutomationGraph(
  config: AutomationConfig,
  layout: AutomationLayout
): { nodes: AutomationFlowNode[]; edges: AutomationFlowEdge[] } {
  const fallbackPositions = computeFallbackPositions(config)

  const nodes = config.nodes.map((node) => {
    const position =
      layout.positions[node.id] ??
      fallbackPositions.get(node.id) ?? {
        x: NODE_LAYOUT_START_X,
        y: NODE_LAYOUT_BASE_Y,
      }
    const meta = describeNode(node)
    return {
      id: node.id,
      type:
        node.type === 'trigger'
          ? 'triggerNode'
          : node.type === 'condition'
            ? 'conditionNode'
            : 'actionNode',
      deletable: node.type !== 'trigger',
      position,
      data: {
        label: meta.label,
        subtitle: meta.subtitle,
        nodeKind: getNodeKind(node),
        configNodeId: node.id,
        configNodeType:
          node.type === 'trigger'
            ? node.triggerType
            : node.type === 'condition'
              ? node.conditionType
              : node.actionType,
        branchHandles: [...getBranchHandles(node)],
        configNode: node,
      },
    } satisfies AutomationFlowNode
  })

  const edges = config.edges.map((edge) => {
    const branch = edge.sourceHandle ?? 'next'

    return {
      id: edge.id,
      source: edge.sourceNodeId,
      target: edge.targetNodeId,
      sourceHandle: branch,
      type: 'smoothstep',
      markerEnd: { type: 'arrowclosed', width: 18, height: 18 },
      data: {
        branch,
      },
    }
  })

  return { nodes, edges }
}
