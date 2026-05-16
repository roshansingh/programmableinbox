import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { ConditionBuilder } from '@/components/automations/condition-builder'
import type { ConditionExprV1 } from '@/lib/automations/types'

function Harness({
  initial,
  onExternalChange,
}: {
  initial: ConditionExprV1
  onExternalChange?: (condition: ConditionExprV1) => void
}) {
  const [condition, setCondition] = useState(initial)

  return (
    <ConditionBuilder
      condition={condition}
      onChange={(next) => {
        setCondition(next)
        onExternalChange?.(next)
      }}
    />
  )
}

describe('ConditionBuilder', () => {
  const initialCondition: ConditionExprV1 = {
    type: 'condition_group',
    version: 1,
    groupOperator: 'all',
    children: [
      {
        type: 'predicate',
        version: 1,
        field: 'subject',
        operator: 'contains',
        value: '',
      },
    ],
  }

  it('reveals header name input when field becomes header', async () => {
    const onChange = vi.fn()
    const { user } = render(
      <Harness
        initial={initialCondition}
        onExternalChange={onChange}
      />
    )

    const triggers = screen.getAllByRole('combobox')
    await user.click(triggers[1])
    await user.click(screen.getByText('Header'))

    const next = onChange.mock.calls.at(-1)?.[0] as ConditionExprV1
    expect(next).toBeTruthy()
    expect(JSON.stringify(next)).toContain('"field":"header"')
    expect(JSON.stringify(next)).toContain('"headerName":""')
  })

  it('switches has_attachment to boolean value updates', async () => {
    const onChange = vi.fn()
    const { user } = render(
      <Harness initial={initialCondition} onExternalChange={onChange} />
    )

    const triggers = screen.getAllByRole('combobox')
    await user.click(triggers[1])
    await user.click(screen.getByText('Has Attachment'))

    const switchControl = screen.getByRole('switch')
    await user.click(switchControl)

    const next = onChange.mock.calls.at(-1)?.[0] as ConditionExprV1
    expect(JSON.stringify(next)).toContain('"field":"has_attachment"')
    expect(JSON.stringify(next)).toContain('"value":false')
  })

  it('offers negative operators for string predicates', async () => {
    const { user } = render(<Harness initial={initialCondition} />)

    const triggers = screen.getAllByRole('combobox')
    await user.click(triggers[2])

    expect(screen.getByText('Does Not Contain')).toBeInTheDocument()
    expect(screen.getByText('Is Not')).toBeInTheDocument()
    expect(screen.getByText('Does Not Exist')).toBeInTheDocument()
  })

  it('hides the value input for not_exists predicates', async () => {
    const onChange = vi.fn()
    const { user } = render(
      <Harness initial={initialCondition} onExternalChange={onChange} />
    )

    const triggers = screen.getAllByRole('combobox')
    await user.click(triggers[2])
    await user.click(screen.getByText('Does Not Exist'))

    const next = onChange.mock.calls.at(-1)?.[0] as ConditionExprV1
    expect(JSON.stringify(next)).toContain('"operator":"not_exists"')
    expect(screen.queryByLabelText('Value')).not.toBeInTheDocument()
  })
})
