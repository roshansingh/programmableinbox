import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useParams } from 'next/navigation'
import { render, screen, waitFor, within } from '@/test/test-utils'
import InboxPage from '@/app/emails/[id]/page'
import {
  getEmailInbox,
  getEmailMessages,
  deleteEmailMessage,
  setEmailMessageRead,
  type EmailMessage,
  type InboxEmail,
} from '@/lib/api/emails.api'

vi.mock('@/components/sidebar', () => ({
  Sidebar: () => <nav data-testid="sidebar">Sidebar</nav>,
}))

vi.mock('@/components/dashboard-header', () => ({
  DashboardHeader: () => <header data-testid="dashboard-header">Header</header>,
}))

vi.mock('@/lib/api/emails.api', () => ({
  getEmailInbox: vi.fn(),
  getEmailMessages: vi.fn(),
  deleteEmailMessage: vi.fn(),
  starEmailMessage: vi.fn(),
  setEmailMessageRead: vi.fn(),
}))

const inbox: InboxEmail = {
  id: 'inbox_1',
  organizationId: 'org_1',
  email: 'support@example.com',
  name: 'Support',
  isOwner: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const message: EmailMessage = {
  id: 'message_1',
  from: 'shipper@example.com',
  to: ['support@example.com'],
  cc: [],
  bcc: [],
  subject: 'Your order has shipped',
  text: 'It is on the way.',
  html: '',
  inboxEmailAddressId: 'inbox_1',
  threadId: 'thread_1',
  parentMessageId: null,
  messageId: '<message_1@example.com>',
  references: [],
  tags: [],
  isStarred: false,
  isRead: true,
  categories: [],
  extractedOtp: null,
  metadata: null,
  createdAt: '2026-01-02T00:00:00.000Z',
}

describe('InboxPage: deleting a message', () => {
  beforeEach(() => {
    // jsdom has no ResizeObserver, which Radix ScrollArea needs on mount.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    vi.mocked(useParams).mockReturnValue({ id: 'inbox_1' })
    vi.mocked(getEmailInbox).mockResolvedValue(inbox)
    vi.mocked(getEmailMessages).mockResolvedValue({
      messages: [message],
      nextCursor: null,
      hasMore: false,
    })
    vi.mocked(setEmailMessageRead).mockResolvedValue(undefined as never)
    vi.mocked(deleteEmailMessage).mockReset()
    vi.mocked(deleteEmailMessage).mockResolvedValue(undefined as never)
  })

  async function openMessage(user: ReturnType<typeof render>['user']) {
    await user.click(await screen.findByText('Your order has shipped'))
    return screen.findByRole('button', { name: 'Delete message' })
  }

  it('asks for confirmation in a modal, not a native dialog, before deleting', async () => {
    const confirmSpy = vi.mocked(window.confirm)
    confirmSpy.mockClear()
    const { user } = render(<InboxPage />)

    await user.click(await openMessage(user))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(/cannot be undone/i)
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(deleteEmailMessage).not.toHaveBeenCalled()
  })

  it('deletes the message once the modal is confirmed', async () => {
    const { user } = render(<InboxPage />)

    await user.click(await openMessage(user))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(deleteEmailMessage).toHaveBeenCalledWith('inbox_1', 'message_1')
    })
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
  })

  it('keeps the message and sends no request when the modal is cancelled', async () => {
    const { user } = render(<InboxPage />)

    await user.click(await openMessage(user))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(deleteEmailMessage).not.toHaveBeenCalled()
    expect(screen.getAllByText('Your order has shipped').length).toBeGreaterThan(0)
  })
})
