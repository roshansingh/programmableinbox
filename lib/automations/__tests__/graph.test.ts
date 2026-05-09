import { describe, expect, it } from 'vitest'
import { compileAutomationGraph } from '@/lib/automations/graph'
import {
  NODE_LAYOUT_BASE_Y,
  NODE_LAYOUT_COLUMN_GAP,
  NODE_LAYOUT_ROW_GAP,
  NODE_LAYOUT_START_X,
  createDefaultAutomationConfig,
  createDefaultAutomationLayout,
} from '@/lib/automations/definitions'
import type { AutomationConfig, AutomationLayout } from '@/lib/automations/types'

describe('compileAutomationGraph', () => {
  it('uses single next handles for trigger and condition and no source handle for action nodes', () => {
    const config = createDefaultAutomationConfig()
    const layout = createDefaultAutomationLayout(config)
    const conditionEdgeConfig = config.edges.find((edge) => edge.id === 'edge_condition_action')

    const graph = compileAutomationGraph(config, layout)
    const trigger = graph.nodes.find((node) => node.id === 'trigger_email_received')
    const condition = graph.nodes.find((node) => node.id === 'condition_subject')
    const action = graph.nodes.find((node) => node.id === 'action_webhook')
    const conditionEdge = graph.edges.find((edge) => edge.id === 'edge_condition_action')

    expect(graph.nodes).toHaveLength(3)
    expect(graph.edges).toHaveLength(2)
    expect(conditionEdgeConfig?.sourceHandle).toBe('next')
    expect(trigger?.data.label).toBe('Email Received')
    expect(trigger?.data.branchHandles).toEqual(['next'])
    expect(condition?.data.branchHandles).toEqual(['next'])
    expect(action?.data.branchHandles).toEqual([])
    expect(graph.edges[0].sourceHandle).toBe('next')
    expect(conditionEdge?.sourceHandle).toBe('next')
    expect(conditionEdge?.label).toBeUndefined()
    expect(conditionEdge?.markerEnd?.type).toBe('arrowclosed')
  })

  it('places nodes without a saved layout entry using BFS depth from the trigger', () => {
    const config = createDefaultAutomationConfig()
    const layout: AutomationLayout = { ...createDefaultAutomationLayout(config), positions: {} }

    const graph = compileAutomationGraph(config, layout)
    const trigger = graph.nodes.find((node) => node.id === 'trigger_email_received')
    const condition = graph.nodes.find((node) => node.id === 'condition_subject')
    const action = graph.nodes.find((node) => node.id === 'action_webhook')

    expect(trigger?.position).toEqual({ x: NODE_LAYOUT_START_X, y: NODE_LAYOUT_BASE_Y })
    expect(condition?.position).toEqual({ x: NODE_LAYOUT_START_X + NODE_LAYOUT_COLUMN_GAP, y: NODE_LAYOUT_BASE_Y })
    expect(action?.position).toEqual({ x: NODE_LAYOUT_START_X + NODE_LAYOUT_COLUMN_GAP * 2, y: NODE_LAYOUT_BASE_Y })
  })

  it('stacks sibling nodes off the same parent vertically without colliding', () => {
    const config: AutomationConfig = {
      ...createDefaultAutomationConfig(),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger',
          version: 1,
          triggerType: 'email.received',
          config: { type: 'email_received', version: 1 },
        },
        {
          id: 'action_a',
          type: 'action',
          version: 1,
          actionType: 'add_tag',
          onError: 'stop',
          config: { type: 'add_tag_config', version: 1, tags: ['a'] },
        },
        {
          id: 'action_b',
          type: 'action',
          version: 1,
          actionType: 'add_tag',
          onError: 'stop',
          config: { type: 'add_tag_config', version: 1, tags: ['b'] },
        },
      ],
      trigger: {
        id: 'trigger',
        type: 'trigger',
        version: 1,
        triggerType: 'email.received',
        config: { type: 'email_received', version: 1 },
      },
      edges: [
        { id: 'e1', type: 'edge', version: 1, sourceNodeId: 'trigger', targetNodeId: 'action_a', sourceHandle: 'next' },
        { id: 'e2', type: 'edge', version: 1, sourceNodeId: 'trigger', targetNodeId: 'action_b', sourceHandle: 'next' },
      ],
    }
    const layout: AutomationLayout = { ...createDefaultAutomationLayout(config), positions: {} }

    const graph = compileAutomationGraph(config, layout)
    const a = graph.nodes.find((node) => node.id === 'action_a')
    const b = graph.nodes.find((node) => node.id === 'action_b')

    expect(a?.position.x).toBe(NODE_LAYOUT_START_X + NODE_LAYOUT_COLUMN_GAP)
    expect(b?.position.x).toBe(NODE_LAYOUT_START_X + NODE_LAYOUT_COLUMN_GAP)
    expect(Math.abs((a?.position.y ?? 0) - (b?.position.y ?? 0))).toBe(NODE_LAYOUT_ROW_GAP)
  })

  it('terminates when the config contains a multi-node cycle', () => {
    const config: AutomationConfig = {
      ...createDefaultAutomationConfig(),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger',
          version: 1,
          triggerType: 'email.received',
          config: { type: 'email_received', version: 1 },
        },
        {
          id: 'cond_a',
          type: 'condition',
          version: 1,
          conditionType: 'predicate_group',
          config: {
            type: 'condition_group',
            version: 1,
            groupOperator: 'all',
            children: [{ type: 'predicate', version: 1, field: 'subject', operator: 'contains', value: 'x' }],
          },
        },
        {
          id: 'cond_b',
          type: 'condition',
          version: 1,
          conditionType: 'predicate_group',
          config: {
            type: 'condition_group',
            version: 1,
            groupOperator: 'all',
            children: [{ type: 'predicate', version: 1, field: 'subject', operator: 'contains', value: 'y' }],
          },
        },
      ],
      trigger: {
        id: 'trigger',
        type: 'trigger',
        version: 1,
        triggerType: 'email.received',
        config: { type: 'email_received', version: 1 },
      },
      edges: [
        { id: 'e1', type: 'edge', version: 1, sourceNodeId: 'trigger', targetNodeId: 'cond_a', sourceHandle: 'next' },
        { id: 'e2', type: 'edge', version: 1, sourceNodeId: 'cond_a', targetNodeId: 'cond_b', sourceHandle: 'next' },
        { id: 'e3', type: 'edge', version: 1, sourceNodeId: 'cond_b', targetNodeId: 'cond_a', sourceHandle: 'next' },
      ],
    }
    const layout: AutomationLayout = { ...createDefaultAutomationLayout(config), positions: {} }

    const graph = compileAutomationGraph(config, layout)

    expect(graph.nodes).toHaveLength(3)
    expect(graph.nodes.find((node) => node.id === 'cond_a')?.position.x).toBe(NODE_LAYOUT_START_X + NODE_LAYOUT_COLUMN_GAP)
    expect(graph.nodes.find((node) => node.id === 'cond_b')?.position.x).toBe(NODE_LAYOUT_START_X + NODE_LAYOUT_COLUMN_GAP * 2)
  })
})
