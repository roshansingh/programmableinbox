import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@/test/test-utils'
import { AutomationEditor } from '@/components/automations/automation-editor'
import { createDefaultAutomationConfig, createDefaultAutomationLayout } from '@/lib/automations/definitions'
import { updateAutomation } from '@/lib/api/automations.api'

let latestReactFlowProps: Record<string, unknown> | null = null

vi.mock('@xyflow/react', async () => {
  const ReactModule = await import('react')

  function ReactFlow(props: any) {
    latestReactFlowProps = props

    return (
      <div data-testid="react-flow">
        {props.nodes.map((node: any) => {
          const NodeComponent = props.nodeTypes?.[node.type]
          return (
            <button
              key={node.id}
              type="button"
              onClick={() => props.onNodeClick?.({}, node)}
            >
              {NodeComponent ? (
                <NodeComponent data={node.data} id={node.id} selected={false} />
              ) : (
                node.data?.label
              )}
            </button>
          )
        })}
        {props.children}
      </div>
    )
  }

  return {
    Background: () => null,
    Controls: () => null,
    Handle: ({ id, type }: { id?: string; type: string }) => (
      <div data-handle-id={id} data-handle-type={type} />
    ),
    Position: { Left: 'left', Right: 'right' },
    ReactFlow,
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    applyNodeChanges: (_changes: any[], nodes: any[]) => nodes,
  }
})

vi.mock('@/components/automations/node-config-sheet', () => ({
  NodeConfigSheet: () => null,
}))

vi.mock('@/components/automations/run-history-panel', () => ({
  RunHistoryPanel: () => null,
}))

vi.mock('@/lib/api/automations.api', () => ({
  dryRunAutomation: vi.fn(),
  duplicateAutomation: vi.fn(),
  updateAutomation: vi.fn(),
}))

describe('AutomationEditor', () => {
  beforeEach(() => {
    vi.mocked(updateAutomation).mockReset()
  })

  it('disables add actions when an action node is selected', async () => {
    const config = createDefaultAutomationConfig()
    const layout = createDefaultAutomationLayout(config)

    const automation = {
      id: 'automation_1',
      organizationId: 'org_1',
      inboxId: null,
      name: 'Test Automation',
      description: null,
      isActive: false,
      status: 'draft' as const,
      activeRevisionId: 'rev_1',
      activeRevisionNumber: 1,
      schemaVersion: 1,
      canStart: true,
      config,
      layout,
      nodes: [],
      edges: [],
      revisions: [],
      createdAt: '2026-05-10T00:00:00.000Z',
      updatedAt: '2026-05-10T00:00:00.000Z',
    }

    const { user } = render(
      <AutomationEditor automation={automation} onAutomationChange={vi.fn()} />
    )

    await user.click(screen.getByRole('button', { name: /Send Webhook .* Action/ }))

    expect(screen.getByRole('button', { name: 'Add Condition' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add Action' })).toBeDisabled()
  })

  it('adds a connected child node from the selected source and enables connections', async () => {
    const config = createDefaultAutomationConfig()
    const layout = createDefaultAutomationLayout(config)

    const automation = {
      id: 'automation_1',
      organizationId: 'org_1',
      inboxId: null,
      name: 'Test Automation',
      description: null,
      isActive: false,
      status: 'draft' as const,
      activeRevisionId: 'rev_1',
      activeRevisionNumber: 1,
      schemaVersion: 1,
      canStart: true,
      config,
      layout,
      nodes: [],
      edges: [],
      revisions: [],
      createdAt: '2026-05-10T00:00:00.000Z',
      updatedAt: '2026-05-10T00:00:00.000Z',
    }

    const { user, container } = render(
      <AutomationEditor automation={automation} onAutomationChange={vi.fn()} />
    )

    await user.click(screen.getByRole('button', { name: /Email Received Trigger/ }))
    await user.click(screen.getByRole('button', { name: 'Add Condition' }))
    expect(latestReactFlowProps?.nodesConnectable).toBe(true)
    expect(
      (latestReactFlowProps?.isValidConnection as ((connection: any) => boolean) | undefined)?.({
        source: 'trigger_email_received',
        target: 'action_webhook',
      })
    ).toBe(true)
    expect(
      (latestReactFlowProps?.isValidConnection as ((connection: any) => boolean) | undefined)?.({
        source: 'condition_2',
        target: 'action_webhook',
      })
    ).toBe(true)
    expect(
      (latestReactFlowProps?.isValidConnection as ((connection: any) => boolean) | undefined)?.({
        source: 'condition_subject',
        target: 'condition_2',
      })
    ).toBe(true)
    expect(
      (latestReactFlowProps?.isValidConnection as ((connection: any) => boolean) | undefined)?.({
        source: 'action_webhook',
        target: 'condition_subject',
      })
    ).toBe(false)

    const sourceHandles = container.querySelectorAll(
      '[data-handle-type="source"][data-handle-id="next"]'
    )
    const targetHandles = container.querySelectorAll('[data-handle-type="target"]')

    expect(sourceHandles).toHaveLength(3)
    expect(targetHandles).toHaveLength(3)

    act(() => {
      ;(latestReactFlowProps?.onConnect as ((connection: any) => void) | undefined)?.({
        source: 'condition_2',
        target: 'action_webhook',
      })
    })
    await user.click(screen.getByRole('tab', { name: 'Config' }))

    expect(screen.getByDisplayValue(/"sourceNodeId": "trigger_email_received"/)).toBeInTheDocument()
    expect(screen.getByDisplayValue(/"targetNodeId": "condition_2"/)).toBeInTheDocument()
    expect(screen.getByDisplayValue(/"sourceNodeId": "condition_2"/)).toBeInTheDocument()
    expect(screen.getByDisplayValue(/"targetNodeId": "action_webhook"/)).toBeInTheDocument()
    expect(
      (latestReactFlowProps?.isValidConnection as ((connection: any) => boolean) | undefined)?.({
        source: 'trigger_email_received',
        target: 'condition_subject',
      })
    ).toBe(false)
  })

  it('disables Start and shows validation issues when no action is reachable', async () => {
    const config = createDefaultAutomationConfig()
    config.nodes = config.nodes.filter((node) => node.type !== 'action')
    config.edges = []
    const layout = createDefaultAutomationLayout(config)

    const automation = {
      id: 'automation_invalid',
      organizationId: 'org_1',
      inboxId: null,
      name: 'Invalid Automation',
      description: null,
      isActive: false,
      status: 'draft' as const,
      activeRevisionId: 'rev_1',
      activeRevisionNumber: 1,
      schemaVersion: 1,
      canStart: false,
      config,
      layout,
      nodes: [],
      edges: [],
      revisions: [],
      createdAt: '2026-05-10T00:00:00.000Z',
      updatedAt: '2026-05-10T00:00:00.000Z',
    }

    render(<AutomationEditor automation={automation} onAutomationChange={vi.fn()} />)

    expect(await screen.findByRole('button', { name: 'Start' })).toBeDisabled()
    expect(
      screen.getByText('at least one reachable action is required from the trigger')
    ).toBeInTheDocument()
  })

  it('saves the current graph before starting a dirty automation', async () => {
    const config = createDefaultAutomationConfig()
    const layout = createDefaultAutomationLayout(config)

    const automation = {
      id: 'automation_dirty',
      organizationId: 'org_1',
      inboxId: null,
      name: 'Dirty Automation',
      description: null,
      isActive: false,
      status: 'draft' as const,
      activeRevisionId: 'rev_1',
      activeRevisionNumber: 1,
      schemaVersion: 1,
      canStart: true,
      config,
      layout,
      nodes: [],
      edges: [],
      revisions: [],
      createdAt: '2026-05-10T00:00:00.000Z',
      updatedAt: '2026-05-10T00:00:00.000Z',
    }

    vi.mocked(updateAutomation).mockImplementation(async (_id, payload) => ({
      ...automation,
      ...payload,
      status: payload.isActive ? 'active' : 'draft',
      updatedAt: '2026-05-11T00:00:00.000Z',
    }))

    const onAutomationChange = vi.fn()
    const { user } = render(
      <AutomationEditor automation={automation} onAutomationChange={onAutomationChange} />
    )

    await user.click(screen.getByRole('button', { name: /Email Received Trigger/ }))
    await user.click(screen.getByRole('button', { name: 'Add Action' }))
    await user.click(screen.getByRole('button', { name: 'Start' }))

    await waitFor(() => {
      expect(updateAutomation).toHaveBeenCalledTimes(1)
    })
    expect(updateAutomation).toHaveBeenCalledWith(
      'automation_dirty',
      expect.objectContaining({
        isActive: true,
        config: expect.objectContaining({
          nodes: expect.arrayContaining([expect.objectContaining({ id: 'action_2' })]),
        }),
        layout: expect.objectContaining({
          positions: expect.any(Object),
        }),
      })
    )
    expect(onAutomationChange).toHaveBeenCalled()
  })
})
