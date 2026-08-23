/**
 * message_search_used (issue #152) on the published v1 read API, mirroring
 * the app dashboard route's coverage.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { withConfigEnv } from '@/test/config'

const resolveApiKeyPrincipalMock = vi.fn()
const listMessagesMock = vi.fn()
const captureEventMock = vi.fn()

vi.mock('@/lib/auth/api-key-auth', () => ({
  resolveApiKeyPrincipal: (...a: unknown[]) => resolveApiKeyPrincipalMock(...a),
}))

vi.mock('@/lib/services/email-inbox', () => ({
  listMessages: (...a: unknown[]) => listMessagesMock(...a),
}))

vi.mock('@/ee/product-analytics/capture', () => ({
  captureEvent: (...args: unknown[]) => captureEventMock(...args),
  PRODUCT_ANALYTICS_EVENTS: { messageSearchUsed: 'message_search_used' },
}))

const KEY = {
  kind: 'apiKey',
  apiKeyId: 'key_1',
  userId: 'user_1',
  organizationId: 'org_1',
  scopes: ['email_inboxes:read', 'email_messages:read'],
}

const params = Promise.resolve({ id: 'inbox_1' })

function request(query = '') {
  return new NextRequest(`http://localhost:4000/api/v1/emailInbox/inbox_1/messages${query}`, {
    headers: { authorization: 'Bearer sk_live_abcdef123456' },
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
  resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
  listMessagesMock.mockResolvedValue({ messages: [], nextCursor: null, hasMore: false })
})

describe('product analytics disabled (the default)', () => {
  withConfigEnv({ ENABLE_PRODUCT_ANALYTICS: 'false' })

  it('does not capture a search request', async () => {
    const { GET } = await import('../route')

    await GET(request('?q=invoice&grouped=false'), { params })

    expect(captureEventMock).not.toHaveBeenCalled()
  })
})

describe('product analytics enabled', () => {
  withConfigEnv({
    ENABLE_PRODUCT_ANALYTICS: 'true',
    POSTHOG_API_KEY: 'phc_test1234567890',
    POSTHOG_HOST: 'https://us.i.posthog.com',
  })

  it('captures message_search_used with the key minter as distinct_id', async () => {
    const { GET } = await import('../route')

    const response = await GET(request('?q=invoice&grouped=false'), { params })

    expect(response.status).toBe(200)
    expect(captureEventMock).toHaveBeenCalledWith(
      'message_search_used',
      'user_1',
      expect.objectContaining({ inboxId: 'inbox_1' }),
    )
  })

  it('does not capture a plain, non-searching listing', async () => {
    const { GET } = await import('../route')

    await GET(request(''), { params })

    expect(captureEventMock).not.toHaveBeenCalled()
  })
})
