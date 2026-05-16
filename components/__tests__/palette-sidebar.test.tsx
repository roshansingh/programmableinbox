import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import { PaletteSidebar } from '@/components/automations/palette-sidebar'

function makeDataTransfer() {
  const data: Record<string, string> = {}
  return {
    setData: (mime: string, value: string) => {
      data[mime] = value
    },
    getData: (mime: string) => data[mime] ?? '',
    effectAllowed: '',
    types: [],
    dropEffect: '',
    items: [],
    files: [],
  }
}

describe('PaletteSidebar', () => {
  it('renders Logic and Actions section headings', () => {
    render(<PaletteSidebar />)

    expect(screen.getByText('Logic')).toBeInTheDocument()
    expect(screen.getByText('Actions')).toBeInTheDocument()
  })

  it('renders one draggable item per catalog entry', () => {
    render(<PaletteSidebar />)

    expect(screen.getByText('Condition').closest('[draggable]')).toHaveAttribute('draggable', 'true')
    expect(screen.getByText('Forward Email').closest('[draggable]')).toHaveAttribute('draggable', 'true')
    expect(screen.getByText('Send Webhook').closest('[draggable]')).toHaveAttribute('draggable', 'true')
    expect(screen.getByText('Auto Reply').closest('[draggable]')).toHaveAttribute('draggable', 'true')
    expect(screen.getByText('Add Tag').closest('[draggable]')).toHaveAttribute('draggable', 'true')
  })

  it('dragstart writes the block key to dataTransfer', () => {
    render(<PaletteSidebar />)

    const dataTransfer = makeDataTransfer()
    const card = screen.getByText('Forward Email').closest('[draggable]') as HTMLElement
    fireEvent.dragStart(card, { dataTransfer })

    expect(dataTransfer.getData('application/x-automation-block')).toBe('forward_email')
    expect(dataTransfer.getData('text/plain')).toBe('forward_email')
  })
})
