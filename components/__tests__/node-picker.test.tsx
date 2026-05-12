import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { NodePicker } from '@/components/automations/node-picker'
import { ALL_BLOCK_KEYS } from '@/lib/automations/block-catalog'

describe('NodePicker', () => {
  it('renders all blocks grouped under Logic and Actions', () => {
    render(<NodePicker allowedKeys={ALL_BLOCK_KEYS} onPick={vi.fn()} />)

    expect(screen.getByText('Logic')).toBeInTheDocument()
    expect(screen.getByText('Actions')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Condition/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Forward Email/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Send Webhook/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Auto Reply/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add Tag/ })).toBeInTheDocument()
  })

  it('respects allowedKeys filtering', () => {
    render(<NodePicker allowedKeys={['condition']} onPick={vi.fn()} />)

    expect(screen.getByRole('button', { name: /Condition/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Forward Email/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Send Webhook/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Actions')).not.toBeInTheDocument()
  })

  it('omits an empty group section', () => {
    render(<NodePicker allowedKeys={['forward_email', 'send_webhook']} onPick={vi.fn()} />)

    expect(screen.queryByText('Logic')).not.toBeInTheDocument()
    expect(screen.getByText('Actions')).toBeInTheDocument()
  })

  it('invokes onPick with the block key when an item is clicked', async () => {
    const onPick = vi.fn()
    const { user } = render(<NodePicker allowedKeys={ALL_BLOCK_KEYS} onPick={onPick} />)

    await user.click(screen.getByRole('button', { name: /Forward Email/ }))

    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith('forward_email')
  })
})
