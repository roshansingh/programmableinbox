import { describe, expect, it } from 'vitest'
import { compileAutomationGraph } from '@/lib/automations/graph'
import { createDefaultAutomationConfig, createDefaultAutomationLayout } from '@/lib/automations/definitions'

describe('compileAutomationGraph', () => {
  it('compiles the default config into renderable flow nodes and edges', () => {
    const config = createDefaultAutomationConfig()
    const layout = createDefaultAutomationLayout(config)

    const graph = compileAutomationGraph(config, layout)

    expect(graph.nodes).toHaveLength(3)
    expect(graph.edges).toHaveLength(2)
    expect(graph.nodes[0].data.label).toBe('Email Received')
    expect(graph.edges[1].label).toBe('matched')
  })
})
