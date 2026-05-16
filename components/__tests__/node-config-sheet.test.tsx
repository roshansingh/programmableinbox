import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { NodeConfigSheet } from '@/components/automations/node-config-sheet'
import {
  AutomationEditorContextProvider,
  type AutomationEditorContextValue,
} from '@/components/automations/automation-editor-context'
import type { AutomationNodeConfig } from '@/lib/automations/types'

function withContext(
  ui: React.ReactNode,
  ctx?: Partial<AutomationEditorContextValue>
) {
  const value: AutomationEditorContextValue = {
    onPickBlock: vi.fn(),
    onDeleteBlock: vi.fn(),
    ...ctx,
  }
  return render(
    <AutomationEditorContextProvider value={value}>
      {ui}
    </AutomationEditorContextProvider>
  )
}

const triggerNode: AutomationNodeConfig = {
  id: 'trigger_1',
  type: 'trigger',
  version: 1,
  triggerType: 'email.received',
  config: { type: 'email_received', version: 1 },
}

const conditionNode: AutomationNodeConfig = {
  id: 'condition_1',
  type: 'condition',
  version: 1,
  conditionType: 'predicate_group',
  config: {
    type: 'condition_group',
    version: 1,
    groupOperator: 'all',
    children: [
      { type: 'predicate', version: 1, field: 'subject', operator: 'contains', value: 'x' },
    ],
  },
}

describe('NodeConfigSheet Delete affordance', () => {
  it('renders a Delete button for non-trigger nodes', () => {
    withContext(
      <NodeConfigSheet
        node={conditionNode}
        open
        onOpenChange={vi.fn()}
        onConditionChange={vi.fn()}
        onActionChange={vi.fn()}
      />
    )

    expect(screen.getByTestId('delete-block')).toBeInTheDocument()
  })

  it('does NOT render a Delete button for the trigger node', () => {
    withContext(
      <NodeConfigSheet
        node={triggerNode}
        open
        onOpenChange={vi.fn()}
        onConditionChange={vi.fn()}
        onActionChange={vi.fn()}
      />
    )

    expect(screen.queryByTestId('delete-block')).not.toBeInTheDocument()
  })

  it('clicking Delete invokes onDeleteBlock with the node id', async () => {
    const onDeleteBlock = vi.fn()
    const { user } = withContext(
      <NodeConfigSheet
        node={conditionNode}
        open
        onOpenChange={vi.fn()}
        onConditionChange={vi.fn()}
        onActionChange={vi.fn()}
      />,
      { onDeleteBlock }
    )

    await user.click(screen.getByTestId('delete-block'))

    expect(onDeleteBlock).toHaveBeenCalledTimes(1)
    expect(onDeleteBlock).toHaveBeenCalledWith('condition_1')
  })
})
