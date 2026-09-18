import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@/test/test-utils'
import { useRouter } from 'next/navigation'
import { AutomationList } from '@/components/automations/automation-list'
import {
  deleteAutomation,
  getAutomations,
  updateAutomation,
  type AutomationRecord,
} from '@/lib/api/automations.api'

vi.mock('@/components/auth-provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/auth-provider')>()
  return {
    ...actual,
    useAuth: () => ({
      organizationId: 'org_123',
    }),
  }
})

vi.mock('@/lib/api/automations.api', () => ({
  getAutomations: vi.fn(),
  createAutomation: vi.fn(),
  updateAutomation: vi.fn(),
  deleteAutomation: vi.fn(),
}))

function makeAutomation(overrides: Partial<AutomationRecord> = {}): AutomationRecord {
  return {
    id: 'automation_1',
    organizationId: 'org_123',
    inboxId: null,
    name: 'Route support email',
    description: 'Routes support messages to the right place',
    isActive: true,
    status: 'active',
    activeRevisionId: 'rev_1',
    activeRevisionNumber: 1,
    schemaVersion: 1,
    canStart: true,
    config: null,
    layout: null,
    nodes: [],
    edges: [],
    revisions: [],
    createdAt: '2026-05-10T00:00:00.000Z',
    updatedAt: '2026-05-10T00:00:00.000Z',
    ...overrides,
  }
}

describe('AutomationList', () => {
  const push = vi.fn()

  beforeEach(() => {
    vi.mocked(useRouter).mockReturnValue({
      push,
      replace: vi.fn(),
      back: vi.fn(),
      prefetch: vi.fn(),
      refresh: vi.fn(),
    })
    push.mockReset()
  })

  it('toggles an automation between active and draft without navigating', async () => {
    vi.mocked(getAutomations).mockResolvedValue([makeAutomation()])
    vi.mocked(updateAutomation).mockResolvedValue(
      makeAutomation({
        isActive: false,
        status: 'draft',
      })
    )

    const { user } = render(<AutomationList />)

    await screen.findByText('Route support email')
    await user.click(screen.getByRole('button', { name: 'Stop' }))

    expect(updateAutomation).toHaveBeenCalledWith('automation_1', { isActive: false })
    expect(push).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.getByText('draft')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()
  })

  it('renders active and draft badges with distinct styling', async () => {
    vi.mocked(getAutomations).mockResolvedValue([
      makeAutomation(),
      makeAutomation({
        id: 'automation_2',
        name: 'Draft automation',
        isActive: false,
        status: 'draft',
      }),
    ])

    render(<AutomationList />)

    const activeBadge = await screen.findByText('active')
    const draftBadge = await screen.findByText('draft')

    expect(activeBadge.className).toContain('bg-emerald-100')
    expect(activeBadge.className).toContain('text-emerald-700')
    expect(draftBadge.className).not.toContain('bg-emerald-100')
  })

  it('disables Start for automations that cannot be activated yet', async () => {
    vi.mocked(getAutomations).mockResolvedValue([
      makeAutomation({
        isActive: false,
        status: 'draft',
        canStart: false,
      }),
    ])

    render(<AutomationList />)

    expect(await screen.findByRole('button', { name: 'Start' })).toBeDisabled()
  })

  describe('deleting an automation', () => {
    beforeEach(() => {
      vi.mocked(getAutomations).mockResolvedValue([makeAutomation()])
      vi.mocked(deleteAutomation).mockReset()
      vi.mocked(deleteAutomation).mockResolvedValue(undefined)
    })

    it('asks for confirmation in a modal, not a native dialog, before deleting', async () => {
      const confirmSpy = vi.mocked(window.confirm)
      confirmSpy.mockClear()
      const { user } = render(<AutomationList />)

      await screen.findByText('Route support email')
      await user.click(screen.getByRole('button', { name: 'Delete' }))

      const dialog = await screen.findByRole('alertdialog')
      expect(dialog).toHaveTextContent('Route support email')
      expect(confirmSpy).not.toHaveBeenCalled()
      expect(deleteAutomation).not.toHaveBeenCalled()
      // Opening the modal is not a click on the row.
      expect(push).not.toHaveBeenCalled()
    })

    it('deletes the automation once the modal is confirmed, without navigating', async () => {
      const { user } = render(<AutomationList />)

      await screen.findByText('Route support email')
      await user.click(screen.getByRole('button', { name: 'Delete' }))
      const dialog = await screen.findByRole('alertdialog')
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

      await waitFor(() => {
        expect(screen.queryByText('Route support email')).not.toBeInTheDocument()
      })
      expect(deleteAutomation).toHaveBeenCalledWith('automation_1')
      // The modal is portalled, but React events still bubble through the
      // tree: confirming must not reach the row's own click-to-open handler.
      expect(push).not.toHaveBeenCalled()
    })

    it('keeps the automation and sends no request when the modal is cancelled', async () => {
      const { user } = render(<AutomationList />)

      await screen.findByText('Route support email')
      await user.click(screen.getByRole('button', { name: 'Delete' }))
      const dialog = await screen.findByRole('alertdialog')
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      })
      expect(deleteAutomation).not.toHaveBeenCalled()
      expect(screen.getByText('Route support email')).toBeInTheDocument()
      expect(push).not.toHaveBeenCalled()
    })
  })
})
