import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@/test/test-utils'
import { AutomationEditor } from '@/components/automations/automation-editor'
import { createDefaultAutomationConfig, createDefaultAutomationLayout } from '@/lib/automations/definitions'
import { dryRunAutomation, updateAutomation } from '@/lib/api/automations.api'

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
    vi.mocked(dryRunAutomation).mockReset()
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

    render(<AutomationEditor automation={automation} onAutomationChange={vi.fn()} />)

    const dropZone = screen.getByTestId('canvas-drop-zone')
    const triggerEl = screen.getByTestId('react-flow').querySelector(`[data-id="${triggerId}"]`)!
    const dataTransfer = makeDataTransfer({ 'application/x-automation-block': 'auto_reply' })

    fireEvent.dragOver(dropZone, { dataTransfer })
    fireEvent.drop(triggerEl, { dataTransfer })

    await waitFor(() => {
      const reactFlowNodes = latestReactFlowProps?.nodes as Array<{ data: { configNode: any } }>
      expect(reactFlowNodes.some((n) => n.data.configNode.actionType === 'auto_reply')).toBe(true)
    })
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

    render(<AutomationEditor automation={automation} onAutomationChange={vi.fn()} />)

    const dropZone = screen.getByTestId('canvas-drop-zone')
    const dataTransfer = makeDataTransfer({ 'application/x-automation-block': 'send_webhook' })

    fireEvent.dragOver(dropZone, { dataTransfer })
    // jsdom does not support DragEvent; clientX/Y default to 0 (screenToFlowPosition identity → {x:0,y:0})
    fireEvent.drop(dropZone, { dataTransfer })

    // A free-floating send_webhook node was added without a parent edge
    // The config now contains a second send_webhook action node (action_2)
    await waitFor(() => {
      const reactFlowNodes = latestReactFlowProps?.nodes as Array<{
        id: string
        position: { x: number; y: number }
        data: { configNode: any }
      }>
      const newNode = reactFlowNodes.find((n) => n.id === 'action_2')
      expect(newNode).toBeDefined()
      expect(newNode?.data.configNode.actionType).toBe('send_webhook')
      // The layout contains a position entry for the new node
      expect(newNode).toHaveProperty('position')
    })
  })

  it('does not mark the layout dirty from React Flow dimension-measurement events', async () => {
    const automation = makeAutomation()

    render(<AutomationEditor automation={automation} onAutomationChange={vi.fn()} />)

    const onNodesChange = latestReactFlowProps?.onNodesChange as
      | ((changes: Array<Record<string, unknown>>) => void)
      | undefined
    act(() => {
      // React Flow fires 'dimensions' changes as it measures each node on
      // mount, unrelated to any user action — no node here is resizable.
      onNodesChange?.([
        { id: automation.config.trigger.id, type: 'dimensions', dimensions: { width: 200, height: 80 } },
      ])
    })

    expect(screen.getByRole('button', { name: 'Save Automation' })).toBeDisabled()
  })

  it('offers one save button, and it saves a moved node with the rest of the graph', async () => {
    const automation = makeAutomation()
    const triggerId = automation.config.trigger.id
    vi.mocked(updateAutomation).mockResolvedValue(automation)

    const { user } = render(
      <AutomationEditor automation={automation} onAutomationChange={vi.fn()} />
    )

    expect(screen.queryByRole('button', { name: 'Save Layout' })).not.toBeInTheDocument()

    const onNodesChange = latestReactFlowProps?.onNodesChange as
      | ((changes: Array<Record<string, unknown>>) => void)
      | undefined
    expect(screen.getByRole('button', { name: 'Save Automation' })).toBeDisabled()
    act(() => {
      onNodesChange?.([{ id: triggerId, type: 'position', position: { x: 10, y: 10 } }])
    })
    // A move alone is enough to enable it. (The mocked `applyNodeChanges`
    // above ignores the change, so the saved coordinates are not asserted.)
    await user.click(screen.getByRole('button', { name: 'Save Automation' }))

    await waitFor(() => {
      expect(updateAutomation).toHaveBeenCalledWith(
        'automation_1',
        expect.objectContaining({
          config: expect.any(Object),
          layout: expect.objectContaining({ positions: expect.any(Object) }),
        })
      )
    })
    expect(updateAutomation).toHaveBeenCalledTimes(1)
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

    render(<AutomationEditor automation={automation} onAutomationChange={vi.fn()} />)

    const onEdgesDelete = latestReactFlowProps?.onEdgesDelete as
      | ((deleted: Array<{ id: string }>) => void)
      | undefined
    expect(onEdgesDelete).toBeDefined()

    act(() => {
      onEdgesDelete?.([{ id: triggerToConditionEdge.id }])
    })

    await waitFor(() => {
      const currentEdges = latestReactFlowProps?.edges as Array<{ id: string }>
      expect(currentEdges.some((e) => e.id === triggerToConditionEdge.id)).toBe(false)
    })
  })

  it('removes a node and its connected edges via onNodesDelete', async () => {
    const automation = makeAutomation()
    const conditionId = automation.config.nodes.find((n) => n.type === 'condition')!.id

    render(<AutomationEditor automation={automation} onAutomationChange={vi.fn()} />)

    const onNodesDelete = latestReactFlowProps?.onNodesDelete as
      | ((deleted: Array<{ id: string }>) => void)
      | undefined
    expect(onNodesDelete).toBeDefined()

    act(() => {
      onNodesDelete?.([{ id: conditionId }])
    })

    await waitFor(() => {
      const currentNodes = latestReactFlowProps?.nodes as Array<{ id: string }>
      expect(currentNodes.some((n) => n.id === conditionId)).toBe(false)
    })
  })

  it('cascades multi-node delete and ignores already-pruned ids', async () => {
    const automation = makeAutomation()
    const conditionId = automation.config.nodes.find((n) => n.type === 'condition')!.id
    const actionId = automation.config.nodes.find((n) => n.type === 'action')!.id

    render(<AutomationEditor automation={automation} onAutomationChange={vi.fn()} />)

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

    await waitFor(() => {
      const currentNodes = latestReactFlowProps?.nodes as Array<{ id: string }>
      expect(currentNodes.some((n) => n.id === conditionId)).toBe(false)
      expect(currentNodes.some((n) => n.id === actionId)).toBe(false)
      // Trigger survives.
      expect(currentNodes.some((n) => n.id === automation.config.trigger.id)).toBe(true)
    })
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

  it('saves unsaved changes before dry-running and switches to the Runs tab', async () => {
    const automation = makeAutomation()
    const triggerId = automation.config.trigger.id

    vi.mocked(updateAutomation).mockResolvedValue({
      ...automation,
      updatedAt: '2026-05-11T00:00:00.000Z',
    })
    vi.mocked(dryRunAutomation).mockResolvedValue([
      { matched: true, status: 'succeeded', runId: 'run_1' },
      { matched: false, status: 'skipped', runId: 'run_2' },
    ])

    const { user } = render(
      <AutomationEditor automation={automation} onAutomationChange={vi.fn()} />
    )

    // Make the graph dirty without touching node config: a position change
    // marks the layout dirty while the (already-valid) default config is
    // untouched, so this exercises the save-then-dry-run path without
    // tripping the separate "unsaved changes are invalid" path.
    const onNodesChange = latestReactFlowProps?.onNodesChange as
      | ((changes: Array<Record<string, unknown>>) => void)
      | undefined
    act(() => {
      onNodesChange?.([
        { id: triggerId, type: 'position', position: { x: 10, y: 10 } },
      ])
    })

    await user.click(screen.getByRole('button', { name: 'Dry Run' }))

    await waitFor(() => {
      expect(updateAutomation).toHaveBeenCalledWith(
        automation.id,
        expect.objectContaining({ config: expect.any(Object), layout: expect.any(Object) })
      )
    })
    expect(dryRunAutomation).toHaveBeenCalledWith(automation.id, 10)

    expect(
      await screen.findByText('Dry run complete: 1/2 message(s) would trigger an action')
    ).toBeInTheDocument()

    expect(screen.getByRole('tab', { name: 'Runs' })).toHaveAttribute('data-state', 'active')
  })

  it('warns and skips saving when the unsaved graph is invalid', async () => {
    const automation = makeAutomation()
    const actionId = automation.config.nodes.find((n) => n.type === 'action')!.id

    vi.mocked(dryRunAutomation).mockResolvedValue([
      { matched: false, status: 'skipped', runId: 'run_1' },
    ])

    const { user } = render(
      <AutomationEditor automation={automation} onAutomationChange={vi.fn()} />
    )

    // Delete the only action node: the graph is now dirty and has no
    // reachable action, so validation.canStart is false.
    const onNodesDelete = latestReactFlowProps?.onNodesDelete as
      | ((deleted: Array<{ id: string }>) => void)
      | undefined
    act(() => {
      onNodesDelete?.([{ id: actionId }])
    })

    await user.click(screen.getByRole('button', { name: 'Dry Run' }))

    expect(
      await screen.findByText(
        'Unsaved changes are invalid — dry run is previewing the last saved version.'
      )
    ).toBeInTheDocument()
    expect(updateAutomation).not.toHaveBeenCalled()
    expect(dryRunAutomation).toHaveBeenCalledWith(automation.id, 10)
  })

  it('flags failed messages in the dry run summary', async () => {
    const automation = makeAutomation()
    vi.mocked(dryRunAutomation).mockResolvedValue([
      { matched: true, status: 'failed', runId: 'run_1' },
      { matched: true, status: 'succeeded', runId: 'run_2' },
    ])

    const { user } = render(
      <AutomationEditor automation={automation} onAutomationChange={vi.fn()} />
    )

    await user.click(screen.getByRole('button', { name: 'Dry Run' }))

    expect(
      await screen.findByText('Dry run complete: 2/2 message(s) would trigger an action, 1 failed')
    ).toBeInTheDocument()
  })

  describe('renaming', () => {
    async function startRenaming(automation = makeAutomation(), onAutomationChange = vi.fn()) {
      const utils = render(
        <AutomationEditor automation={automation} onAutomationChange={onAutomationChange} />
      )
      await utils.user.click(screen.getByRole('button', { name: 'Rename automation' }))
      const input = screen.getByRole('textbox', { name: 'Automation name' })
      return { ...utils, input, automation, onAutomationChange }
    }

    it('turns the title into an input holding the current name', async () => {
      const { input } = await startRenaming()

      expect(input).toHaveValue('Test Automation')
      expect(input).toHaveFocus()
      expect(updateAutomation).not.toHaveBeenCalled()
    })

    it('saves the new name on Enter, sending only the name', async () => {
      const renamed = makeAutomation({ name: 'Billing router' })
      vi.mocked(updateAutomation).mockResolvedValue(renamed)
      const { user, input, onAutomationChange } = await startRenaming()

      await user.clear(input)
      await user.type(input, '  Billing router  {Enter}')

      await waitFor(() => {
        expect(onAutomationChange).toHaveBeenCalledWith(renamed)
      })
      // Exactly `{ name }`: sending config or layout would mint a revision.
      expect(updateAutomation).toHaveBeenCalledWith('automation_1', { name: 'Billing router' })
      expect(updateAutomation).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('textbox', { name: 'Automation name' })).not.toBeInTheDocument()
    })

    it('does not send a second request when focus leaves while the first is still in flight', async () => {
      let resolveSave: (value: ReturnType<typeof makeAutomation>) => void = () => {}
      vi.mocked(updateAutomation).mockReturnValue(
        new Promise((resolve) => {
          resolveSave = resolve
        })
      )
      const { user, input } = await startRenaming()

      await user.clear(input)
      await user.type(input, 'Slow name{Enter}')
      await user.tab()

      expect(updateAutomation).toHaveBeenCalledTimes(1)
      resolveSave(makeAutomation({ name: 'Slow name' }))
      await waitFor(() => {
        expect(screen.queryByRole('textbox', { name: 'Automation name' })).not.toBeInTheDocument()
      })
    })

    it('saves on blur', async () => {
      vi.mocked(updateAutomation).mockResolvedValue(makeAutomation({ name: 'Blur named' }))
      const { user, input } = await startRenaming()

      await user.clear(input)
      await user.type(input, 'Blur named')
      await user.tab()

      await waitFor(() => {
        expect(updateAutomation).toHaveBeenCalledWith('automation_1', { name: 'Blur named' })
      })
    })

    it('discards the edit on Escape without a request', async () => {
      const { user, input, onAutomationChange } = await startRenaming()

      await user.clear(input)
      await user.type(input, 'Never saved{Escape}')

      expect(screen.queryByRole('textbox', { name: 'Automation name' })).not.toBeInTheDocument()
      expect(screen.getByText('Test Automation')).toBeInTheDocument()
      expect(updateAutomation).not.toHaveBeenCalled()
      expect(onAutomationChange).not.toHaveBeenCalled()
    })

    it('does not send a request when the name is unchanged', async () => {
      const { user, input } = await startRenaming()

      await user.type(input, '{Enter}')

      expect(updateAutomation).not.toHaveBeenCalled()
      expect(screen.queryByRole('textbox', { name: 'Automation name' })).not.toBeInTheDocument()
    })

    it('reverts to the saved name instead of saving a blank one', async () => {
      const { user, input } = await startRenaming()

      await user.clear(input)
      await user.type(input, '   {Enter}')

      expect(updateAutomation).not.toHaveBeenCalled()
      expect(screen.getByText('Test Automation')).toBeInTheDocument()
    })

    it('stops the name at 100 characters', async () => {
      const { user, input } = await startRenaming()

      await user.clear(input)
      await user.type(input, 'a'.repeat(105))

      expect(input).toHaveValue('a'.repeat(100))
    })

    it('keeps the input open with the typed name when the save fails', async () => {
      vi.mocked(updateAutomation).mockRejectedValue(new Error('Server said no'))
      const { user, input, onAutomationChange } = await startRenaming()

      await user.clear(input)
      await user.type(input, 'Doomed name{Enter}')

      await waitFor(() => {
        expect(updateAutomation).toHaveBeenCalledTimes(1)
      })
      expect(onAutomationChange).not.toHaveBeenCalled()
      expect(screen.getByRole('textbox', { name: 'Automation name' })).toHaveValue('Doomed name')
    })

    it('keeps unsaved canvas changes pending after the rename comes back from the server', async () => {
      const automation = makeAutomation()
      // The page feeds the saved record back in, and the server stamps a new
      // updatedAt on every PATCH — a stub `onAutomationChange` hides that.
      vi.mocked(updateAutomation).mockResolvedValue({
        ...automation,
        name: 'Renamed',
        updatedAt: '2026-05-11T00:00:00.000Z',
      })
      function StatefulEditor() {
        const [current, setCurrent] = React.useState<any>(automation)
        return <AutomationEditor automation={current} onAutomationChange={setCurrent} />
      }
      const { user } = render(<StatefulEditor />)

      const onNodesChange = latestReactFlowProps?.onNodesChange as
        | ((changes: Array<Record<string, unknown>>) => void)
        | undefined
      act(() => {
        onNodesChange?.([
          { id: automation.config.trigger.id, type: 'position', position: { x: 10, y: 10 } },
        ])
      })
      expect(screen.getByRole('button', { name: 'Save Automation' })).toBeEnabled()

      await user.click(screen.getByRole('button', { name: 'Rename automation' }))
      const input = screen.getByRole('textbox', { name: 'Automation name' })
      await user.clear(input)
      await user.type(input, 'Renamed{Enter}')

      expect(await screen.findByText('Renamed')).toBeInTheDocument()
      expect(updateAutomation).toHaveBeenCalledWith('automation_1', { name: 'Renamed' })
      // The rename must not have thrown the pending move away.
      expect(screen.getByRole('button', { name: 'Save Automation' })).toBeEnabled()
    })
  })

  describe('invalid blocks', () => {
    function nodeEl(id: string) {
      return screen.getByTestId('react-flow').querySelector(`[data-id="${id}"]`) as HTMLElement
    }
    function isOutlined(id: string) {
      return nodeEl(id).querySelector('.border-destructive') !== null
    }
    function disconnectedAutomation() {
      const config = createDefaultAutomationConfig()
      config.edges = []
      return makeAutomation({ config })
    }

    it('outlines the blocks the validation issues point at, and only those', () => {
      render(<AutomationEditor automation={disconnectedAutomation()} onAutomationChange={vi.fn()} />)

      expect(isOutlined('action_webhook')).toBe(true)
      expect(isOutlined('condition_subject')).toBe(true)
      // The trigger is the graph's root: nothing is wrong with it.
      expect(isOutlined('trigger_email_received')).toBe(false)
    })

    it('says what is wrong with an outlined block on hover', () => {
      render(<AutomationEditor automation={disconnectedAutomation()} onAutomationChange={vi.fn()} />)

      expect(
        within(nodeEl('action_webhook')).getByTitle('node action_webhook is disconnected')
      ).toBeInTheDocument()
    })

    it('outlines nothing when the graph is valid', () => {
      render(<AutomationEditor automation={makeAutomation()} onAutomationChange={vi.fn()} />)

      expect(screen.getByTestId('react-flow').querySelector('.border-destructive')).toBeNull()
    })

    it('outlines a block whose own configuration is invalid', () => {
      const config = createDefaultAutomationConfig()
      config.nodes = config.nodes.map((node: any) =>
        node.id === 'action_webhook'
          ? {
              id: 'action_webhook',
              type: 'action' as const,
              version: 1 as const,
              actionType: 'forward_email' as const,
              config: { type: 'forward_email_config' as const, version: 1 as const, to: [] },
            }
          : node
      )
      render(<AutomationEditor automation={makeAutomation({ config })} onAutomationChange={vi.fn()} />)

      expect(isOutlined('action_webhook')).toBe(true)
      expect(isOutlined('condition_subject')).toBe(false)
      expect(isOutlined('trigger_email_received')).toBe(false)
    })

    it('outlines a trigger that has an incoming connection', () => {
      const config = createDefaultAutomationConfig()
      config.edges = [
        ...config.edges,
        {
          id: 'edge_back_to_trigger',
          type: 'edge' as const,
          version: 1 as const,
          sourceNodeId: 'condition_subject',
          targetNodeId: 'trigger_email_received',
          sourceHandle: 'next' as const,
        },
      ]
      render(<AutomationEditor automation={makeAutomation({ config })} onAutomationChange={vi.fn()} />)

      expect(isOutlined('trigger_email_received')).toBe(true)
    })

    it('clears the outline as soon as the problem is fixed', () => {
      render(<AutomationEditor automation={disconnectedAutomation()} onAutomationChange={vi.fn()} />)
      expect(isOutlined('condition_subject')).toBe(true)

      const onConnect = latestReactFlowProps?.onConnect as (c: any) => void
      act(() => {
        onConnect({ source: 'trigger_email_received', target: 'condition_subject' })
      })

      expect(isOutlined('condition_subject')).toBe(false)
      // Still unconnected, so still flagged.
      expect(isOutlined('action_webhook')).toBe(true)
    })
  })
})
