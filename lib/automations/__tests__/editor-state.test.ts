import { describe, expect, it } from 'vitest'
import {
  addChildNode,
  addFreeNode,
  connectNodes,
  deleteNodeCascade,
  validateAutomationGraph,
} from '@/components/automations/editor-state'
import { createDefaultAutomationConfig, createDefaultAutomationLayout } from '@/lib/automations/definitions'
import { automationConfigSchema } from '@/lib/automations/schemas'

function expectIssueMessage(result: ReturnType<typeof automationConfigSchema.safeParse>, message: string) {
  expect(result.success).toBe(false)
  expect(JSON.stringify(result.error?.issues ?? [])).toContain(message)
}

describe('automationConfigSchema', () => {
  it('rejects a graph with no reachable action from the trigger', () => {
    const config = createDefaultAutomationConfig()

    config.nodes = config.nodes.filter((node) => node.type !== 'action')
    config.edges = config.edges.filter((edge) => edge.targetNodeId !== 'action_webhook')

    const result = automationConfigSchema.safeParse(config)

    expectIssueMessage(result, 'reachable action')
  })

  it('rejects disconnected nodes even when another action is reachable', () => {
    const config = createDefaultAutomationConfig()

    config.nodes.push({
      id: 'action_reply',
      type: 'action',
      version: 1,
      actionType: 'auto_reply',
      config: {
        type: 'auto_reply_config',
        version: 1,
        subjectTemplate: 'Thanks',
        bodyTemplate: 'We got it.',
      },
    })

    const result = automationConfigSchema.safeParse(config)

    expectIssueMessage(result, 'disconnected')
  })

  it('rejects edges that reference a missing node', () => {
    const config = createDefaultAutomationConfig()

    config.edges.push({
      id: 'edge_missing_target',
      type: 'edge',
      version: 1,
      sourceNodeId: 'trigger_email_received',
      targetNodeId: 'missing_node',
    })

    const result = automationConfigSchema.safeParse(config)

    expectIssueMessage(result, 'references missing node')
  })

  it('rejects self-loop edges', () => {
    const config = createDefaultAutomationConfig()

    config.edges.push({
      id: 'edge_self_loop',
      type: 'edge',
      version: 1,
      sourceNodeId: 'condition_subject',
      targetNodeId: 'condition_subject',
    })

    const result = automationConfigSchema.safeParse(config)

    expectIssueMessage(result, 'self-loop')
  })

  it('rejects duplicate connections', () => {
    const config = createDefaultAutomationConfig()

    config.edges.push({
      ...config.edges[0],
      id: 'edge_duplicate',
    })

    const result = automationConfigSchema.safeParse(config)

    expectIssueMessage(result, 'duplicates an existing connection')
  })

  it('rejects invalid source-target pairs', () => {
    const config = createDefaultAutomationConfig()

    config.edges.push({
      id: 'edge_action_to_trigger',
      type: 'edge',
      version: 1,
      sourceNodeId: 'action_webhook',
      targetNodeId: 'trigger_email_received',
    })

    const result = automationConfigSchema.safeParse(config)

    expectIssueMessage(result, 'invalid connection action_webhook -> trigger_email_received')
  })

  it('rejects trigger nodes with incoming edges', () => {
    const config = createDefaultAutomationConfig()

    config.edges.push({
      id: 'edge_into_trigger',
      type: 'edge',
      version: 1,
      sourceNodeId: 'condition_subject',
      targetNodeId: 'trigger_email_received',
    })

    const result = automationConfigSchema.safeParse(config)

    expectIssueMessage(result, 'trigger node trigger_email_received cannot have incoming edges')
  })

  it('rejects action nodes with outgoing edges', () => {
    const config = createDefaultAutomationConfig()

    config.edges.push({
      id: 'edge_from_action',
      type: 'edge',
      version: 1,
      sourceNodeId: 'action_webhook',
      targetNodeId: 'condition_subject',
    })

    const result = automationConfigSchema.safeParse(config)

    expectIssueMessage(result, 'action node action_webhook cannot have outgoing edges')
  })

  it('rejects legacy matched and unmatched edge handles', () => {
    const config = createDefaultAutomationConfig()
    const invalidConfig = {
      ...config,
      edges: [
        {
          ...config.edges[0],
          sourceHandle: 'matched',
        },
        ...config.edges.slice(1),
      ],
    }

    const result = automationConfigSchema.safeParse(invalidConfig)

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toContain('Invalid literal value')
  })

  it('accepts negative predicate operators in condition expressions', () => {
    const config = createDefaultAutomationConfig()
    const condition = config.nodes.find((node) => node.id === 'condition_subject')

    if (!condition || condition.type !== 'condition') {
      throw new Error('expected default condition node')
    }
    if (condition.config.type !== 'condition_group') {
      throw new Error('expected default condition group config')
    }

    condition.config.children = [
      {
        type: 'predicate',
        version: 1,
        field: 'subject',
        operator: 'not_contains',
        value: 'spam',
      },
      {
        type: 'predicate',
        version: 1,
        field: 'header',
        headerName: 'x-priority',
        operator: 'not_exists',
      },
    ]

    const result = automationConfigSchema.safeParse(config)

    expect(result.success).toBe(true)
  })

  it('accepts not_equals predicates with a matching value type', () => {
    const config = createDefaultAutomationConfig()
    const condition = config.nodes.find((node) => node.id === 'condition_subject')

    if (!condition || condition.type !== 'condition') {
      throw new Error('expected default condition node')
    }
    if (condition.config.type !== 'condition_group') {
      throw new Error('expected default condition group config')
    }

    condition.config.children = [
      {
        type: 'predicate',
        version: 1,
        field: 'subject',
        operator: 'not_equals',
        value: 'spam',
      },
    ]

    const result = automationConfigSchema.safeParse(config)

    expect(result.success).toBe(true)
  })
})

describe('editor-state graph helpers', () => {
  it('adds a condition node as a connected child of the selected source', () => {
    const config = createDefaultAutomationConfig()

    const next = addChildNode(config, {
      sourceNodeId: 'trigger_email_received',
      key: 'condition',
    })

    const newNode = next.config.nodes.find(
      (node) =>
        node.id !== 'trigger_email_received' &&
        node.id !== 'condition_subject' &&
        node.id !== 'action_webhook'
    )

    expect(next.newNodeId).toBeTruthy()
    expect(newNode?.type).toBe('condition')
    expect(
      next.config.edges.some(
        (edge) =>
          edge.sourceNodeId === 'trigger_email_received' && edge.targetNodeId === newNode?.id
      )
    ).toBe(true)
  })

  it('connects two existing nodes with a next edge', () => {
    const config = createDefaultAutomationConfig()
    const withActionResult = addChildNode(config, {
      sourceNodeId: 'condition_subject',
      key: 'send_webhook',
    })
    const withAction = withActionResult.config

    const newAction = withAction.nodes.find((node) => node.id.startsWith('action_') && node.id !== 'action_webhook')
    if (!newAction) throw new Error('expected a newly added action node')

    const disconnected = {
      ...withAction,
      edges: withAction.edges.filter((edge) => edge.targetNodeId !== newAction.id),
    }

    const next = connectNodes(disconnected, {
      sourceNodeId: 'condition_subject',
      targetNodeId: newAction.id,
    })

    expect(
      next.edges.some(
        (edge) =>
          edge.sourceNodeId === 'condition_subject' &&
          edge.targetNodeId === newAction.id &&
          edge.sourceHandle === 'next'
      )
    ).toBe(true)
  })

  it('cascades deletion to descendants that become disconnected from the trigger', () => {
    const config = createDefaultAutomationConfig()

    const next = deleteNodeCascade(config, 'condition_subject')

    expect(next.nodes.some((node) => node.id === 'condition_subject')).toBe(false)
    expect(next.nodes.some((node) => node.id === 'action_webhook')).toBe(false)
  })

  it('does not delete the trigger node', () => {
    const config = createDefaultAutomationConfig()

    const next = deleteNodeCascade(config, config.trigger.id)

    expect(next).toEqual(config)
  })

  it('does not mutate the graph when deleting a missing node id', () => {
    const config = createDefaultAutomationConfig()

    const next = deleteNodeCascade(config, 'missing_node')

    expect(next).toEqual(config)
  })

  it('reports graph validation issues and start readiness', () => {
    const config = createDefaultAutomationConfig()
    config.nodes = config.nodes.filter((node) => node.type !== 'action')
    config.edges = []

    const validation = validateAutomationGraph(config)

    expect(validation.canStart).toBe(false)
    expect(validation.issues.some((issue) => issue.code === 'no_reachable_action')).toBe(true)
    expect(
      validation.issues.some(
        (issue) => issue.message === 'at least one reachable action is required from the trigger'
      )
    ).toBe(true)
  })

  it('accepts a valid default graph', () => {
    const config = createDefaultAutomationConfig()

    const validation = validateAutomationGraph(config)

    expect(validation.canStart).toBe(true)
    expect(validation.issues).toEqual([])
  })

  it('matches schema trigger integrity when the top-level trigger is missing from nodes', () => {
    const config = createDefaultAutomationConfig()
    config.nodes = config.nodes.filter((node) => node.id !== config.trigger.id)
    config.edges = config.edges.filter(
      (edge) => edge.sourceNodeId !== config.trigger.id && edge.targetNodeId !== config.trigger.id
    )

    const validation = validateAutomationGraph(config)

    expect(validation.canStart).toBe(false)
    expect(
      validation.issues.some((issue) => issue.message === 'top-level trigger must exist in nodes')
    ).toBe(true)
  })

  it('matches schema trigger integrity when duplicate trigger nodes exist', () => {
    const config = createDefaultAutomationConfig()
    config.nodes.push({
      id: 'trigger_duplicate',
      type: 'trigger',
      version: 1,
      triggerType: 'email.received',
      config: {
        type: 'email_received',
        version: 1,
      },
    })

    const validation = validateAutomationGraph(config)

    expect(validation.canStart).toBe(false)
    expect(
      validation.issues.some((issue) => issue.message === 'exactly one trigger node is required')
    ).toBe(true)
  })

  it('refuses to add a child when the source node is missing', () => {
    const config = createDefaultAutomationConfig()

    const next = addChildNode(config, {
      sourceNodeId: 'missing_node',
      key: 'condition',
    })

    expect(next.newNodeId).toBeNull()
    expect(next.config).toBe(config)
  })

  it('refuses to add a child when the source node is an action', () => {
    const config = createDefaultAutomationConfig()

    const next = addChildNode(config, {
      sourceNodeId: 'action_webhook',
      key: 'condition',
    })

    expect(next.newNodeId).toBeNull()
    expect(next.config).toBe(config)
  })

  it('refuses to connect when either endpoint is missing', () => {
    const config = createDefaultAutomationConfig()

    expect(
      connectNodes(config, {
        sourceNodeId: 'missing_source',
        targetNodeId: 'condition_subject',
      })
    ).toEqual(config)

    expect(
      connectNodes(config, {
        sourceNodeId: 'trigger_email_received',
        targetNodeId: 'missing_target',
      })
    ).toEqual(config)
  })

  it('refuses duplicate, self-loop, and invalid connections', () => {
    const config = createDefaultAutomationConfig()

    expect(
      connectNodes(config, {
        sourceNodeId: 'trigger_email_received',
        targetNodeId: 'condition_subject',
      })
    ).toEqual(config)

    expect(
      connectNodes(config, {
        sourceNodeId: 'condition_subject',
        targetNodeId: 'condition_subject',
      })
    ).toEqual(config)

    expect(
      connectNodes(config, {
        sourceNodeId: 'action_webhook',
        targetNodeId: 'trigger_email_received',
      })
    ).toEqual(config)
  })

  it('reports duplicate edges without adding a generic invalid_connection issue', () => {
    const config = createDefaultAutomationConfig()
    config.edges.push({
      ...config.edges[0],
      id: 'edge_duplicate_again',
    })

    const validation = validateAutomationGraph(config)

    expect(validation.issues.some((issue) => issue.code === 'duplicate_edge')).toBe(true)
    expect(
      validation.issues.some(
        (issue) =>
          issue.code === 'invalid_connection' &&
          issue.message === 'invalid connection trigger_email_received -> condition_subject'
      )
    ).toBe(false)
  })

  it('reports self loops without adding a generic invalid_connection issue', () => {
    const config = createDefaultAutomationConfig()
    config.edges.push({
      id: 'edge_loop_again',
      type: 'edge',
      version: 1,
      sourceNodeId: 'condition_subject',
      targetNodeId: 'condition_subject',
      sourceHandle: 'next',
    })

    const validation = validateAutomationGraph(config)

    expect(validation.issues.some((issue) => issue.code === 'self_loop')).toBe(true)
    expect(
      validation.issues.some(
        (issue) =>
          issue.code === 'invalid_connection' &&
          issue.message === 'invalid connection condition_subject -> condition_subject'
      )
    ).toBe(false)
  })

  it('refuses connections into the trigger and out of an action node', () => {
    const config = createDefaultAutomationConfig()

    expect(
      connectNodes(config, {
        sourceNodeId: 'condition_subject',
        targetNodeId: 'trigger_email_received',
      })
    ).toEqual(config)

    expect(
      connectNodes(config, {
        sourceNodeId: 'action_webhook',
        targetNodeId: 'condition_subject',
      })
    ).toEqual(config)
  })
})

describe('addChildNode return shape', () => {
  it('returns newNodeId when a child is added', () => {
    const config = createDefaultAutomationConfig()
    const result = addChildNode(config, {
      sourceNodeId: config.trigger.id,
      key: 'forward_email',
    })

    expect(result.newNodeId).toBeTruthy()
    expect(result.config.nodes.find((n) => n.id === result.newNodeId)).toMatchObject({
      type: 'action',
      actionType: 'forward_email',
    })
  })

  it('returns newNodeId === null when the source rejects children', () => {
    const config = createDefaultAutomationConfig()
    const actionNode = config.nodes.find((n) => n.type === 'action')!

    const result = addChildNode(config, {
      sourceNodeId: actionNode.id,
      key: 'send_webhook',
    })

    expect(result.newNodeId).toBeNull()
    expect(result.config).toBe(config)
  })
})

describe('addFreeNode', () => {
  it('creates a disconnected node at the given position', () => {
    const config = createDefaultAutomationConfig()
    const layout = createDefaultAutomationLayout(config)

    const result = addFreeNode(config, layout, {
      key: 'add_tag',
      position: { x: 999, y: 555 },
    })

    expect(result.newNodeId).toBeTruthy()
    expect(result.config.nodes.find((n) => n.id === result.newNodeId)).toMatchObject({
      type: 'action',
      actionType: 'add_tag',
    })
    // No new edges
    expect(result.config.edges.length).toBe(config.edges.length)
    // Layout position written eagerly
    expect(result.layout.positions[result.newNodeId!]).toEqual({ x: 999, y: 555 })
  })
})
