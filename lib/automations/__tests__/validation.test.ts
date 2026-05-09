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
})
