import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, renderWithoutAuth } from '@/test/test-utils'
import { ComposeEmailDialog } from '@/components/compose-email-dialog'
import type { EmailMessage } from '@/lib/api/emails.api'

const sendEmailMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api/emails.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/emails.api')>()
  return { ...actual, sendEmail: sendEmailMock }
})

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

function message(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id: 'message-1',
    from: 'first@example.com',
    to: ['inbox@example.com'],
    cc: [],
    bcc: [],
    subject: 'First subject',
    text: 'First body',
    html: '',
    inboxEmailAddressId: 'inbox-1',
    threadId: 'thread-1',
    parentMessageId: null,
    messageId: '<message-1@example.com>',
    references: ['<root@example.com>'],
    tags: [],
    isStarred: false,
    isRead: false,
    categories: [],
    extractedOtp: null,
    metadata: null,
    createdAt: '2026-08-11T13:05:13.000Z',
    ...overrides,
  }
}

describe('ComposeEmailDialog', () => {
  beforeEach(() => {
    sendEmailMock.mockReset()
  })

  it('starts a fresh draft for each compose session', () => {
    const onOpenChange = vi.fn()
    const firstMessage = message()
    const secondMessage = message({
      id: 'message-2',
      from: 'second@example.com',
      subject: 'Second subject',
      text: 'Second body',
      messageId: '<message-2@example.com>',
    })

    const { rerender } = renderWithoutAuth(
      <ComposeEmailDialog
        open
        onOpenChange={onOpenChange}
        inboxId="inbox-1"
        inboxEmail="inbox@example.com"
        mode="reply"
        originalMessage={firstMessage}
        composeSessionId={1}
      />,
    )

    expect(screen.getByLabelText('To')).toHaveValue('first@example.com')
    expect(screen.getByLabelText('Subject')).toHaveValue('Re: First subject')

    rerender(
      <ComposeEmailDialog
        open
        onOpenChange={onOpenChange}
        inboxId="inbox-1"
        inboxEmail="inbox@example.com"
        mode="forward"
        originalMessage={secondMessage}
        composeSessionId={2}
      />,
    )

    expect(screen.getByLabelText('To')).toHaveValue('')
    expect(screen.getByLabelText('Subject')).toHaveValue('Fwd: Second subject')
    const body = (screen.getByLabelText('Message') as HTMLTextAreaElement).value
    expect(body).toContain('Second body')
    expect(body).not.toContain('First body')
  })

  it('builds reply references without mutating the original message across retries', async () => {
    sendEmailMock
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({ messageId: 'sent-1' })
    const originalMessage = message()
    const { user } = renderWithoutAuth(
      <ComposeEmailDialog
        open
        onOpenChange={vi.fn()}
        inboxId="inbox-1"
        inboxEmail="inbox@example.com"
        mode="reply"
        originalMessage={originalMessage}
        composeSessionId={1}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(sendEmailMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(sendEmailMock).toHaveBeenCalledTimes(2))

    expect(sendEmailMock.mock.calls[0][1].references).toBe(
      '<root@example.com> <message-1@example.com>',
    )
    expect(sendEmailMock.mock.calls[1][1].references).toBe(
      '<root@example.com> <message-1@example.com>',
    )
    expect(originalMessage.references).toEqual(['<root@example.com>'])
  })
})
