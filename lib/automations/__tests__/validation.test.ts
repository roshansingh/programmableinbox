import { describe, expect, it } from 'vitest'
import { createDefaultAutomationConfig } from '@/lib/automations/definitions'
import { assertAutomationCanStart, validateAutomationGraph } from '@/lib/automations/validation'

describe('automation activation validation', () => {
  it('rejects activation when no action is reachable', () => {
    const config = createDefaultAutomationConfig()
    config.nodes = config.nodes.filter((node) => node.type !== 'action')
    config.edges = config.edges.filter((edge) => edge.targetNodeId !== 'action_webhook')

    expect(validateAutomationGraph(config).canStart).toBe(false)
    expect(() => assertAutomationCanStart(config)).toThrow(
      'at least one reachable action is required from the trigger'
    )
  })

  it('allows activation when the trigger reaches an action', () => {
    const config = createDefaultAutomationConfig()

    expect(() => assertAutomationCanStart(config)).not.toThrow()
  })

  it('flags a forward_email node with an empty recipient list', () => {
    const config = createDefaultAutomationConfig()
    config.nodes = [
      config.trigger,
      {
        id: 'fwd_1',
        type: 'action',
        version: 1,
        actionType: 'forward_email',
        onError: 'stop',
        config: { type: 'forward_email_config', version: 1, to: [], includeAttachments: false },
      },
    ]
    config.edges = [
      { id: 'e1', type: 'edge', version: 1, sourceNodeId: config.trigger.id, targetNodeId: 'fwd_1', sourceHandle: 'next' },
    ]

    const result = validateAutomationGraph(config)

    expect(result.canStart).toBe(false)
    expect(result.issues.some((i) => i.code === 'node_config_invalid' && i.nodeId === 'fwd_1' && /recipient/i.test(i.message))).toBe(true)
  })
})
