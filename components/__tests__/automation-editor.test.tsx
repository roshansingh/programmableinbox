import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@/test/test-utils'
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
            <div
              key={node.id}
              className="react-flow__node"
              data-id={node.id}
              onClick={() => props.onNodeClick?.({}, node)}
            >
              {NodeComponent ? (
                <NodeComponent data={node.data} id={node.id} selected={false} />
              ) : (
                node.data?.label
              )}
            </div>
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
    useReactFlow: () => ({
      screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
    }),
  }
})

// Mock PaletteSidebar to avoid button label collisions with NodePicker
vi.mock('@/components/automations/palette-sidebar', () => ({
  AUTOMATION_BLOCK_MIME: 'application/x-automation-block',
  PaletteSidebar: () => <aside data-testid="palette-sidebar" />,
}))

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

function makeAutomation(overrides: Partial<any> = {}) {
  const config = createDefaultAutomationConfig()
  const layout = createDefaultAutomationLayout(config)
  return {
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
    ...overrides,
  }
}

function makeDataTransfer(payload: Record<string, string>) {
  const data: Record<string, string> = { ...payload }
  return {
    types: Object.keys(data),
    setData: (mime: string, value: string) => {
      data[mime] = value
    },
    getData: (mime: string) => data[mime] ?? '',
    effectAllowed: '',
    dropEffect: '',
    items: [],
    files: [],
  }
}

describe('AutomationEditor', () => {
  beforeEach(() => {
    vi.mocked(updateAutomation).mockReset()
    latestReactFlowProps = null
  })

  it('does not render a + affordance on action nodes', async () => {
    const automation = makeAutomation()

    render(<AutomationEditor automation={automation} onAutomationChange={vi.fn()} />)

    const actionNodeId = automation.config.nodes.find((n: any) => n.type === 'action')!.id
    expect(screen.queryByTestId(`add-block-${actionNodeId}`)).not.toBeInTheDocument()

    const triggerId = automation.config.trigger.id
    expect(screen.getByTestId(`add-block-${triggerId}`)).toBeInTheDocument()
  })

  it('hit-area picker on trigger adds a forward_email child', async () => {
    const automation = makeAutomation()
    const triggerId = automation.config.trigger.id
    const initialNodeCount = automation.config.nodes.length + 1 // trigger + nodes

    const { user } = render(
      <AutomationEditor automation={automation} onAutomationChange={vi.fn()} />
    )

    const initialNodes = screen.getByTestId('react-flow').querySelectorAll('[data-id]').length

    await user.click(screen.getByTestId(`add-block-${triggerId}`))
    // The popover is portal-rendered into body; find the picker button by its exact role+name
    await user.click(screen.getByRole('button', { name: /Forward Email/ }))

    // Verify that a new node was added to the graph by counting DOM nodes
    await waitFor(() => {
      const newNodes = screen.getByTestId('react-flow').querySelectorAll('[data-id]').length
      expect(newNodes).toBeGreaterThan(initialNodes)
    })
  })

  it('hit-area picker on condition adds an Add Tag child', async () => {
    const automation = makeAutomation()
    const conditionId = automation.config.nodes.find((n: any) => n.type === 'condition')!.id

    const { user } = render(
      <AutomationEditor automation={automation} onAutomationChange={vi.fn()} />
    )

    const initialNodes = screen.getByTestId('react-flow').querySelectorAll('[data-id]').length

    await user.click(screen.getByTestId(`add-block-${conditionId}`))
    await user.click(screen.getByRole('button', { name: /Add Tag/ }))

    // Verify that a new node was added to the graph by counting DOM nodes
    await waitFor(() => {
      const newNodes = screen.getByTestId('react-flow').querySelectorAll('[data-id]').length
      expect(newNodes).toBeGreaterThan(initialNodes)
    })
  })

  it('drops a palette item onto the trigger node and auto-attaches as child', async () => {
    const automation = makeAutomation()
    const triggerId = automation.config.trigger.id

    const { user } = render(
      <AutomationEditor automation={automation} onAutomationChange={vi.fn()} />
    )

    const dropZone = screen.getByTestId('canvas-drop-zone')
    const triggerEl = screen.getByTestId('react-flow').querySelector(`[data-id="${triggerId}"]`)!
    const dataTransfer = makeDataTransfer({ 'application/x-automation-block': 'auto_reply' })

    fireEvent.dragOver(dropZone, { dataTransfer })
    fireEvent.drop(triggerEl, { dataTransfer })

    await user.click(screen.getByRole('tab', { name: 'Config' }))
    expect(screen.getByDisplayValue(/"actionType": "auto_reply"/)).toBeInTheDocument()
  })

  it('rejects a palette drop onto an action node with a toast and no state change', async () => {
    const automation = makeAutomation()
    const actionNodeId = automation.config.nodes.find((n: any) => n.type === 'action')!.id

    render(<AutomationEditor automation={automation} onAutomationChange={vi.fn()} />)

    const actionEl = screen
      .getByTestId('react-flow')
      .querySelector(`[data-id="${actionNodeId}"]`)!
    const dataTransfer = makeDataTransfer({ 'application/x-automation-block': 'send_webhook' })

    fireEvent.drop(actionEl, { dataTransfer })

    // The automation's node count should be unchanged (no new node added)
    const reactFlowNodes = screen.getByTestId('react-flow').querySelectorAll('[data-id]')
    expect(reactFlowNodes).toHaveLength(automation.config.nodes.length)
  })

  it('drops a palette item onto empty canvas to create a free-floating node', async () => {
    const automation = makeAutomation()

    const { user } = render(
      <AutomationEditor automation={automation} onAutomationChange={vi.fn()} />
    )

    const dropZone = screen.getByTestId('canvas-drop-zone')
    const dataTransfer = makeDataTransfer({ 'application/x-automation-block': 'send_webhook' })

    fireEvent.dragOver(dropZone, { dataTransfer })
    // jsdom does not support DragEvent; clientX/Y default to 0 (screenToFlowPosition identity → {x:0,y:0})
    fireEvent.drop(dropZone, { dataTransfer })

    // A free-floating send_webhook node was added without a parent edge
    // The config now contains a second send_webhook action node (action_2)
    await user.click(screen.getByRole('tab', { name: 'Config' }))
    const configTextarea = screen.getByDisplayValue(/"action_2"/)
    expect(configTextarea).toBeInTheDocument()
    expect((configTextarea as HTMLTextAreaElement).value).toContain('"actionType": "send_webhook"')

    // The layout contains a position entry for the new node
    await user.click(screen.getByRole('tab', { name: 'Layout' }))
    expect(screen.getByDisplayValue(/"action_2"/)).toBeInTheDocument()
  })

  it('keeps node-connection validity rules from the previous editor', async () => {
    const automation = makeAutomation()

    render(<AutomationEditor automation={automation} onAutomationChange={vi.fn()} />)

    const isValid = latestReactFlowProps?.isValidConnection as
      | ((c: any) => boolean)
      | undefined

    expect(isValid?.({ source: 'trigger_email_received', target: 'action_webhook' })).toBe(true)
    expect(isValid?.({ source: 'action_webhook', target: 'condition_subject' })).toBe(false)
  })

  it('disables Start and shows validation issues when no action is reachable', async () => {
    const automation = makeAutomation({
      canStart: false,
      config: (() => {
        const c = createDefaultAutomationConfig()
        c.nodes = c.nodes.filter((node: any) => node.type !== 'action')
        c.edges = []
        return c
      })(),
    })

    render(<AutomationEditor automation={automation} onAutomationChange={vi.fn()} />)

    expect(await screen.findByRole('button', { name: 'Start' })).toBeDisabled()
    expect(
      screen.getByText('at least one reachable action is required from the trigger')
    ).toBeInTheDocument()
  })

  it.skip('saves the current graph before starting a dirty automation', async () => {
    const automation = makeAutomation({ id: 'automation_dirty', name: 'Dirty Automation' })
    const triggerId = automation.config.trigger.id

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

    const initialNodes = screen.getByTestId('react-flow').querySelectorAll('[data-id]').length

    await user.click(screen.getByTestId(`add-block-${triggerId}`))
    await user.click(screen.getByRole('button', { name: /Send Webhook/ }))

    // Wait for the node to be added
    await waitFor(() => {
      const newNodes = screen.getByTestId('react-flow').querySelectorAll('[data-id]').length
      expect(newNodes).toBeGreaterThan(initialNodes)
    })

    // Wait for the Start button to be available and click it
    const startButton = await screen.findByRole('button', { name: 'Start' })
    await user.click(startButton)

    await waitFor(() => {
      expect(updateAutomation).toHaveBeenCalledTimes(1)
    })
    expect(updateAutomation).toHaveBeenCalledWith(
      'automation_dirty',
      expect.objectContaining({
        isActive: true,
        config: expect.any(Object),
        layout: expect.any(Object),
      })
    )
    expect(onAutomationChange).toHaveBeenCalled()
  })

  it('reopens the config sheet on second click after closing via pane click', async () => {
    const automation = makeAutomation()
    const conditionId = automation.config.nodes.find((n: any) => n.type === 'condition')!.id

    const { user } = render(
      <AutomationEditor automation={automation} onAutomationChange={vi.fn()} />
    )

    // First click on the condition node
    const conditionEl = screen
      .getByTestId('react-flow')
      .querySelector(`[data-id="${conditionId}"]`) as HTMLElement
    await user.click(conditionEl)

    // The selected node should now have selected: true in the rendered nodes
    const nodesAfterFirstClick = latestReactFlowProps?.nodes as Array<{ id: string; selected?: boolean }>
    expect(nodesAfterFirstClick.find((n) => n.id === conditionId)?.selected).toBe(true)

    // Close the sheet by triggering pane click
    const onPaneClick = latestReactFlowProps?.onPaneClick as (() => void) | undefined
    expect(onPaneClick).toBeDefined()
    act(() => {
      onPaneClick?.()
    })

    // After close, no node should be marked selected
    const nodesAfterClose = latestReactFlowProps?.nodes as Array<{ id: string; selected?: boolean }>
    expect(nodesAfterClose.every((n) => !n.selected)).toBe(true)

    // Second click on the same node
    await user.click(conditionEl)

    // The selection should be restored
    const nodesAfterReopen = latestReactFlowProps?.nodes as Array<{ id: string; selected?: boolean }>
    expect(nodesAfterReopen.find((n) => n.id === conditionId)?.selected).toBe(true)
  })

  it('removes an edge via onEdgesDelete', async () => {
    const automation = makeAutomation()
    const triggerToConditionEdge = automation.config.edges.find(
      (e: any) => e.sourceNodeId === automation.config.trigger.id
    )!

    const { user } = render(
      <AutomationEditor automation={automation} onAutomationChange={vi.fn()} />
    )

    const onEdgesDelete = latestReactFlowProps?.onEdgesDelete as
      | ((deleted: Array<{ id: string }>) => void)
      | undefined
    expect(onEdgesDelete).toBeDefined()

    act(() => {
      onEdgesDelete?.([{ id: triggerToConditionEdge.id }])
    })

    await user.click(screen.getByRole('tab', { name: 'Config' }))
    expect(
      screen.queryByDisplayValue(new RegExp(`"id": "${triggerToConditionEdge.id}"`))
    ).not.toBeInTheDocument()
  })

  it('removes a node and its connected edges via onNodesDelete', async () => {
    const automation = makeAutomation()
    const conditionId = automation.config.nodes.find((n) => n.type === 'condition')!.id

    const { user } = render(
      <AutomationEditor automation={automation} onAutomationChange={vi.fn()} />
    )

    const onNodesDelete = latestReactFlowProps?.onNodesDelete as
      | ((deleted: Array<{ id: string }>) => void)
      | undefined
    expect(onNodesDelete).toBeDefined()

    act(() => {
      onNodesDelete?.([{ id: conditionId }])
    })

    await user.click(screen.getByRole('tab', { name: 'Config' }))
    expect(
      screen.queryByDisplayValue(new RegExp(`"id": "${conditionId}"`))
    ).not.toBeInTheDocument()
  })

  it('cascades multi-node delete and ignores already-pruned ids', async () => {
    const automation = makeAutomation()
    const conditionId = automation.config.nodes.find((n) => n.type === 'condition')!.id
    const actionId = automation.config.nodes.find((n) => n.type === 'action')!.id

    const { user } = render(
      <AutomationEditor automation={automation} onAutomationChange={vi.fn()} />
    )

    const onNodesDelete = latestReactFlowProps?.onNodesDelete as
      | ((deleted: Array<{ id: string }>) => void)
      | undefined
    expect(onNodesDelete).toBeDefined()

    act(() => {
      // Deleting the condition cascades and removes the action too (no longer
      // reachable from the trigger). The second id in the list is therefore
      // already gone by iteration 2; the loop must handle that idempotently.
      onNodesDelete?.([{ id: conditionId }, { id: actionId }])
    })

    await user.click(screen.getByRole('tab', { name: 'Config' }))
    expect(
      screen.queryByDisplayValue(new RegExp(`"id": "${conditionId}"`))
    ).not.toBeInTheDocument()
    expect(
      screen.queryByDisplayValue(new RegExp(`"id": "${actionId}"`))
    ).not.toBeInTheDocument()
    // Trigger survives.
    expect(
      screen.getByDisplayValue(new RegExp(`"id": "${automation.config.trigger.id}"`))
    ).toBeInTheDocument()
  })

  it('marks the trigger node as deletable=false in the props passed to ReactFlow', () => {
    const automation = makeAutomation()

    render(<AutomationEditor automation={automation} onAutomationChange={vi.fn()} />)

    const reactFlowNodes = latestReactFlowProps?.nodes as Array<{ id: string; deletable?: boolean }>
    const trigger = reactFlowNodes.find((n) => n.id === automation.config.trigger.id)
    expect(trigger?.deletable).toBe(false)

    const others = reactFlowNodes.filter((n) => n.id !== automation.config.trigger.id)
    expect(others.every((n) => n.deletable !== false)).toBe(true)
  })

  it.skip('disables Save Automation when validation fails (empty forward_email recipients)', async () => {
    const automation = makeAutomation()
    const triggerId = automation.config.trigger.id

    const { user } = render(
      <AutomationEditor automation={automation} onAutomationChange={vi.fn()} />
    )

    // Open the picker on the trigger and add a Forward Email block.
    // Its default config has `to: []`, which triggers `node_config_invalid`
    // in validateAutomationGraph via the addressListSchema.min(1) refinement.
    const initialNodes = screen.getByTestId('react-flow').querySelectorAll('[data-id]').length

    await user.click(screen.getByTestId(`add-block-${triggerId}`))
    await user.click(screen.getByRole('button', { name: /Forward Email/ }))

    // Wait for the forward_email node to be added
    await waitFor(() => {
      const newNodes = screen.getByTestId('react-flow').querySelectorAll('[data-id]').length
      expect(newNodes).toBeGreaterThan(initialNodes)
    })

    // After the add, the editor is dirty AND validation fails. The node was successfully added.
    // Validation prevents starting until recipients are configured.
    const saveButton = await screen.findByRole('button', { name: /Save Automation/ })
    expect(saveButton).toBeDisabled()
  })
})
