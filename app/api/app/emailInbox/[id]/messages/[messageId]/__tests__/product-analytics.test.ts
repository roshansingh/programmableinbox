/**
 * message_viewed (issue #152), fired from the isRead PATCH branch only when
 * isRead flips to true — marking a message unread again is not "viewing" it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { withConfigEnv } from '@/test/config'

const resolveUserPrincipalFromTokenMock = vi.fn()
const emailInboxFindFirstMock = vi.fn()
const emailMessageFindFirstMock = vi.fn()
const emailMessageUpdateMock = vi.fn()
const captureEventMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  resolveUserPrincipalFromToken: (...args: unknown[]) =>
    resolveUserPrincipalFromTokenMock(...args),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    emailInbox: { findFirst: (...a: unknown[]) => emailInboxFindFirstMock(...a), findMany: vi.fn() },
    emailMessage: {
      findFirst: (...a: unknown[]) => emailMessageFindFirstMock(...a),
      update: (...a: unknown[]) => emailMessageUpdateMock(...a),
      findMany: vi.fn(),
    },
  },
}))

vi.mock('@/ee/product-analytics/capture', () => ({
  captureEvent: (...args: unknown[]) => captureEventMock(...args),
  PRODUCT_ANALYTICS_EVENTS: { messageViewed: 'message_viewed' },
}))

const PRINCIPAL = {
  kind: 'user' as const,
  userId: 'user_1',
  email: 'user@example.com',
  memberships: [{ organizationId: 'org_1', role: 'owner' }],
}

const TOKEN = 'Bearer header.payload.signature'
const INBOX = { id: 'inbox_1', organizationId: 'org_1', userId: 'user_1' }
const MESSAGE = {
  id: 'msg_1',
  inboxEmailAddressId: 'inbox_1',
  isRead: false,
  isStarred: false,
  createdAt: new Date('2026-01-03T00:00:00.000Z'),
}
const params = Promise.resolve({ id: 'inbox_1', messageId: 'msg_1' })

beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
  resolveUserPrincipalFromTokenMock.mockResolvedValue(PRINCIPAL)
  emailInboxFindFirstMock.mockResolvedValue(INBOX)
  emailMessageFindFirstMock.mockResolvedValue(MESSAGE)
})

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/app/emailInbox/inbox_1/messages/msg_1', {
    method: 'PATCH',
    headers: { authorization: TOKEN },
    body: JSON.stringify(body),
  })
}

describe('product analytics disabled (the default)', () => {
  withConfigEnv({ ENABLE_PRODUCT_ANALYTICS: 'false' })

  it('does not capture anything when marking a message read', async () => {
    emailMessageUpdateMock.mockResolvedValue({ ...MESSAGE, isRead: true })
    const { PATCH } = await import('../route')

    await PATCH(patchRequest({ isRead: true }), { params })

    expect(captureEventMock).not.toHaveBeenCalled()
  })
})

describe('product analytics enabled', () => {
  withConfigEnv({
    ENABLE_PRODUCT_ANALYTICS: 'true',
    POSTHOG_API_KEY: 'phc_test1234567890',
    POSTHOG_HOST: 'https://us.i.posthog.com',
  })

  it('captures message_viewed when isRead flips to true', async () => {
    emailMessageUpdateMock.mockResolvedValue({ ...MESSAGE, isRead: true })
    const { PATCH } = await import('../route')

    await PATCH(patchRequest({ isRead: true }), { params })

    expect(captureEventMock).toHaveBeenCalledWith(
      'message_viewed',
      'user_1',
      expect.objectContaining({ inboxId: 'inbox_1', messageId: 'msg_1' }),
    )
  })

  it('does not capture message_viewed when isRead flips back to false', async () => {
    emailMessageUpdateMock.mockResolvedValue({ ...MESSAGE, isRead: false })
    const { PATCH } = await import('../route')

    await PATCH(patchRequest({ isRead: false }), { params })

    expect(captureEventMock).not.toHaveBeenCalled()
  })

  it('does not capture message_viewed for an isStarred PATCH', async () => {
    emailMessageUpdateMock.mockResolvedValue({ ...MESSAGE, isStarred: true })
    const { PATCH } = await import('../route')

    await PATCH(patchRequest({ isStarred: true }), { params })

    expect(captureEventMock).not.toHaveBeenCalled()
  })

  it('does not capture when the message is not found', async () => {
    emailMessageFindFirstMock.mockResolvedValue(null)
    const { PATCH } = await import('../route')

    const response = await PATCH(patchRequest({ isRead: true }), { params })

    expect(response.status).toBe(404)
    expect(captureEventMock).not.toHaveBeenCalled()
  })
})
