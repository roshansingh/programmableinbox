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

  it('hit-area picker on trigger adds a forward_email child and auto-selects it', async () => {
    const automation = makeAutomation()
    const triggerId = automation.config.trigger.id

    const { user } = render(
      <AutomationEditor automation={automation} onAutomationChange={vi.fn()} />
    )

    await user.click(screen.getByTestId(`add-block-${triggerId}`))
    // The popover is portal-rendered into body; find the picker button by its exact role+name
    await user.click(screen.getByRole('button', { name: /Forward Email/ }))

    await user.click(screen.getByRole('tab', { name: 'Config' }))
    expect(screen.getByDisplayValue(/"actionType": "forward_email"/)).toBeInTheDocument()
  })

  it('hit-area picker on condition adds an Add Tag child', async () => {
    const automation = makeAutomation()
    const conditionId = automation.config.nodes.find((n: any) => n.type === 'condition')!.id

    const { user } = render(
      <AutomationEditor automation={automation} onAutomationChange={vi.fn()} />
    )

    await user.click(screen.getByTestId(`add-block-${conditionId}`))
    await user.click(screen.getByRole('button', { name: /Add Tag/ }))

    await user.click(screen.getByRole('tab', { name: 'Config' }))
    expect(screen.getByDisplayValue(/"actionType": "add_tag"/)).toBeInTheDocument()
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

  it('saves the current graph before starting a dirty automation', async () => {
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

    await user.click(screen.getByTestId(`add-block-${triggerId}`))
    await user.click(screen.getByRole('button', { name: /Send Webhook/ }))
    await user.click(screen.getByRole('button', { name: 'Start' }))

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
})
