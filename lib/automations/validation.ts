import type {
  AutomationConfig,
  AutomationNodeConfig,
  AutomationValidationIssue,
  AutomationValidationResult,
} from './types'

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

function isAllowedConnectionPair(
  sourceNode: AutomationNodeConfig,
  targetNode: AutomationNodeConfig
) {
  return (
    (sourceNode.type === 'trigger' &&
      (targetNode.type === 'condition' || targetNode.type === 'action')) ||
    (sourceNode.type === 'condition' &&
      (targetNode.type === 'condition' || targetNode.type === 'action'))
  )
}

export function validateAutomationGraph(config: AutomationConfig): AutomationValidationResult {
  const issues: AutomationValidationIssue[] = []
  const nodeMap = new Map(config.nodes.map((node) => [node.id, node]))
  const triggerNodes = config.nodes.filter((node) => node.type === 'trigger')
  const incoming = new Map<string, AutomationConfig['edges']>()
  const outgoing = new Map<string, AutomationConfig['edges']>()
  const seenEdgeKeys = new Set<string>()

  if (triggerNodes.length !== 1) {
    issues.push({
      code: 'invalid_connection',
      nodeId: config.trigger.id,
      message: 'exactly one trigger node is required',
    })
  }

  if (!nodeMap.has(config.trigger.id)) {
    issues.push({
      code: 'invalid_connection',
      nodeId: config.trigger.id,
      message: 'top-level trigger must exist in nodes',
    })
  }

  for (const edge of config.edges) {
    const source = nodeMap.get(edge.sourceNodeId)
    const target = nodeMap.get(edge.targetNodeId)

    if (!source || !target) {
      issues.push({
        code: 'invalid_connection',
        edgeId: edge.id,
        message: `edge ${edge.id} references missing node`,
      })
      continue
    }

    if (edge.sourceNodeId === edge.targetNodeId) {
      issues.push({
        code: 'self_loop',
        edgeId: edge.id,
        nodeId: edge.sourceNodeId,
        message: `edge ${edge.id} may not be a self-loop`,
      })
    }

    const edgeKey = `${edge.sourceNodeId}:${edge.targetNodeId}:${edge.sourceHandle ?? 'next'}`
    if (seenEdgeKeys.has(edgeKey)) {
      issues.push({
        code: 'duplicate_edge',
        edgeId: edge.id,
        message: `edge ${edge.id} duplicates an existing connection`,
      })
    }
    seenEdgeKeys.add(edgeKey)

    if (!isAllowedConnectionPair(source, target)) {
      issues.push({
        code: 'invalid_connection',
        edgeId: edge.id,
        message: `invalid connection ${source.id} -> ${target.id}`,
      })
    }

    outgoing.set(edge.sourceNodeId, [...(outgoing.get(edge.sourceNodeId) ?? []), edge])
    incoming.set(edge.targetNodeId, [...(incoming.get(edge.targetNodeId) ?? []), edge])
  }

  const reachable = getReachableNodeIds(config)

  for (const node of config.nodes) {
    if (node.type === 'trigger' && (incoming.get(node.id)?.length ?? 0) > 0) {
      issues.push({
        code: 'trigger_incoming_edge',
        nodeId: node.id,
        message: `trigger node ${node.id} cannot have incoming edges`,
      })
    }

    if (node.type === 'action' && (outgoing.get(node.id)?.length ?? 0) > 0) {
      issues.push({
        code: 'action_outgoing_edge',
        nodeId: node.id,
        message: `action node ${node.id} cannot have outgoing edges`,
      })
    }

    if (!reachable.has(node.id)) {
      issues.push({
        code: 'disconnected_node',
        nodeId: node.id,
        message: `node ${node.id} is disconnected`,
      })
    }
  }

  const hasReachableAction = config.nodes.some(
    (node) => node.type === 'action' && reachable.has(node.id)
  )

  if (!hasReachableAction) {
    issues.push({
      code: 'no_reachable_action',
      message: 'at least one reachable action is required from the trigger',
    })
  }

  return {
    issues,
    canStart: issues.length === 0,
  }
}

export function assertAutomationCanStart(config: AutomationConfig) {
  const validation = validateAutomationGraph(config)
  if (!validation.canStart) {
    throw new Error(validation.issues[0]?.message ?? 'Automation is not ready to start')
  }
}
