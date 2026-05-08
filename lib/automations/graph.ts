import type {
  AutomationConfig,
  AutomationFlowEdge,
  AutomationFlowNode,
  AutomationLayout,
  AutomationNodeConfig,
} from './types'

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

export function compileAutomationGraph(
  config: AutomationConfig,
  layout: AutomationLayout
): { nodes: AutomationFlowNode[]; edges: AutomationFlowEdge[] } {
  const nodes = config.nodes.map((node, index) => {
    const position = layout.positions[node.id] ?? {
      x: node.type === 'trigger' ? 40 : 300 + index * 220,
      y: 80 + index * 40,
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
      position,
      data: {
        label: meta.label,
        subtitle: meta.subtitle,
        configNode: node,
      },
    } satisfies AutomationFlowNode
  })

  const edges = config.edges.map((edge) => ({
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    label: edge.sourceHandle,
    sourceHandle: edge.sourceHandle,
  }))

  return { nodes, edges }
}
