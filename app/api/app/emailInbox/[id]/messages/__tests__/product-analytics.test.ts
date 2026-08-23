/**
 * message_search_used (issue #152), fired from GET
 * /api/app/emailInbox/[id]/messages when the request carries a non-null
 * MessageSearch (issue #106) — i.e. `q`, `from`, `tags` or `categories`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { withConfigEnv } from '@/test/config'

const resolveUserPrincipalFromTokenMock = vi.fn()
const emailInboxFindFirstMock = vi.fn()
const emailMessageFindManyMock = vi.fn()
const fetchGroupedThreadHeadsMock = vi.fn()
const fetchSearchedMessagesMock = vi.fn()
const captureEventMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  resolveUserPrincipalFromToken: (...args: unknown[]) =>
    resolveUserPrincipalFromTokenMock(...args),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    emailInbox: { findFirst: (...a: unknown[]) => emailInboxFindFirstMock(...a), findMany: vi.fn() },
    emailMessage: { findMany: (...a: unknown[]) => emailMessageFindManyMock(...a), findFirst: vi.fn() },
  },
}))

vi.mock('@/lib/services/grouped-query', () => ({
  fetchGroupedThreadHeads: (...a: unknown[]) => fetchGroupedThreadHeadsMock(...a),
}))

vi.mock('@/lib/services/message-search', () => ({
  fetchSearchedMessages: (...a: unknown[]) => fetchSearchedMessagesMock(...a),
}))

vi.mock('@/lib/product-analytics/capture', () => ({
  captureEvent: (...args: unknown[]) => captureEventMock(...args),
  PRODUCT_ANALYTICS_EVENTS: { messageSearchUsed: 'message_search_used' },
}))

const PRINCIPAL = {
  kind: 'user' as const,
  userId: 'user_1',
  email: 'user@example.com',
  memberships: [{ organizationId: 'org_1', role: 'owner' }],
}

const TOKEN = 'Bearer header.payload.signature'
const INBOX = { id: 'inbox_1', organizationId: 'org_1', userId: 'user_1' }

const params = Promise.resolve({ id: 'inbox_1' })

beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
  resolveUserPrincipalFromTokenMock.mockResolvedValue(PRINCIPAL)
  emailInboxFindFirstMock.mockResolvedValue(INBOX)
  emailMessageFindManyMock.mockResolvedValue([])
  fetchSearchedMessagesMock.mockResolvedValue([])
})

function get(query: string) {
  return new NextRequest(`http://localhost/api/app/emailInbox/inbox_1/messages${query}`, {
    headers: { authorization: TOKEN },
  })
}

describe('product analytics disabled (the default)', () => {
  withConfigEnv({ ENABLE_PRODUCT_ANALYTICS: 'false' })

  it('does not capture a search request', async () => {
    const { GET } = await import('../route')

    await GET(get('?q=invoice&grouped=false'), { params })

    expect(captureEventMock).not.toHaveBeenCalled()
  })
})

describe('product analytics enabled', () => {
  withConfigEnv({
    ENABLE_PRODUCT_ANALYTICS: 'true',
    POSTHOG_API_KEY: 'phc_test1234567890',
    POSTHOG_HOST: 'https://us.i.posthog.com',
  })

  it('captures message_search_used for a q search', async () => {
    const { GET } = await import('../route')

    const response = await GET(get('?q=invoice&grouped=false'), { params })

    expect(response.status).toBe(200)
    expect(captureEventMock).toHaveBeenCalledWith(
      'message_search_used',
      'user_1',
      expect.objectContaining({ inboxId: 'inbox_1' }),
    )
  })

  it('captures message_search_used for a from-only search', async () => {
    const { GET } = await import('../route')

    await GET(get('?from=stripe.com&grouped=false'), { params })

    expect(captureEventMock).toHaveBeenCalledWith(
      'message_search_used',
      'user_1',
      expect.objectContaining({ inboxId: 'inbox_1' }),
    )
  })

  it('does not capture a plain, non-searching listing', async () => {
    const { GET } = await import('../route')

    await GET(get(''), { params })

    expect(captureEventMock).not.toHaveBeenCalled()
  })

  it('does not capture when search parsing rejects the request (grouped+search)', async () => {
    const { GET } = await import('../route')

    const response = await GET(get('?q=invoice&grouped=true'), { params })

    expect(response.status).toBe(400)
    expect(captureEventMock).not.toHaveBeenCalled()
  })
})
