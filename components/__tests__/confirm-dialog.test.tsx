import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@/test/test-utils'
import { ConfirmDialog } from '@/components/confirm-dialog'

function setup(overrides: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  const onOpenChange = vi.fn()
  const onConfirm = vi.fn()
  const utils = render(
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title="Delete thing?"
      description="This cannot be undone."
      onConfirm={onConfirm}
      {...overrides}
    />
  )
  return { ...utils, onOpenChange, onConfirm }
}

describe('ConfirmDialog', () => {
  it('renders the title and description as an alert dialog', () => {
    setup()

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText('Delete thing?')).toBeInTheDocument()
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument()
  })

  it('renders nothing when closed', () => {
    setup({ open: false })

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('defaults the confirm button to "Delete"', () => {
    setup()

    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('uses a custom confirm label', () => {
    setup({ confirmLabel: 'Replay live' })

    expect(screen.getByRole('button', { name: 'Replay live' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('runs onConfirm and then closes when confirmed', async () => {
    const { user, onConfirm, onOpenChange } = setup()

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('does not run onConfirm when cancelled', async () => {
    const { user, onConfirm, onOpenChange } = setup()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('does not run onConfirm when dismissed with Escape', async () => {
    const { user, onConfirm, onOpenChange } = setup()

    await user.keyboard('{Escape}')

    expect(onConfirm).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('stays open and disables both buttons while onConfirm is pending', async () => {
    let finish: () => void = () => {}
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const { user, onOpenChange } = setup({ onConfirm })

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /delete/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()

    finish()
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})
