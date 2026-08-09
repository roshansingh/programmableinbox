import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { withConfigEnv } from '@/test/config'

const resolveUserPrincipalFromTokenMock = vi.fn()
const resolveApiKeyPrincipalMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  resolveUserPrincipalFromToken: (...args: unknown[]) =>
    resolveUserPrincipalFromTokenMock(...args),
}))

vi.mock('@/lib/auth/api-key-auth', () => ({
  resolveApiKeyPrincipal: (...args: unknown[]) => resolveApiKeyPrincipalMock(...args),
}))

function requestWith(authorization?: string) {
  return new NextRequest('http://localhost:4000/api/test', {
    headers: authorization ? { authorization } : {},
  })
}

const emptyCtx = { params: Promise.resolve({}) }

const USER = {
  kind: 'user' as const,
  userId: 'user_1',
  email: 'user@example.com',
  emailVerified: true,
  memberships: [{ organizationId: 'org_1', role: 'owner' }],
}

const UNVERIFIED = { ...USER, emailVerified: false }

const KEY = {
  kind: 'apiKey' as const,
  apiKeyId: 'key_1',
  organizationId: 'org_1',
  scopes: ['email_inboxes:read', 'email_messages:read'],
}

describe('withUser', () => {
  beforeEach(() => vi.resetAllMocks())

  it('401s with no Authorization header', async () => {
    const { withUser } = await import('../with-auth')
    const handler = withUser(async () => new Response('ok'))

    const response = await handler(requestWith(), emptyCtx)
    expect(response.status).toBe(401)
  })

  it('passes the resolved principal to the handler', async () => {
    resolveUserPrincipalFromTokenMock.mockResolvedValue(USER)
    const { withUser } = await import('../with-auth')

    let seen: unknown
    const handler = withUser(async (_req, principal) => {
      seen = principal
      return new Response('ok')
    })

    await handler(requestWith('Bearer jwt.token.here'), emptyCtx)
    expect(seen).toEqual(USER)
  })

  it('rejects an API key without attempting JWT verification', async () => {
    const { withUser } = await import('../with-auth')
    const handler = withUser(async () => new Response('ok'))

    const response = await handler(requestWith('Bearer sk_live_abcdef123456'), emptyCtx)

    expect(response.status).toBe(401)
    expect(resolveUserPrincipalFromTokenMock).not.toHaveBeenCalled()
  })
})

/**
 * The soft gate (issue #102 §7.1). Verification is required by *default*, so
 * a route that never thought about it fails closed; the opt-out has to be
 * written deliberately.
 */
describe('withUser email-verification gate', () => {
  beforeEach(() => vi.resetAllMocks())

  describe('when the deployment requires verification', () => {
    withConfigEnv({
      ENABLE_EMAIL_VERIFICATION: 'true',
      EMAIL_LINK_SECRET: 'verification-secret-at-least-16',
      APP_BASE_URL: 'https://app.example.com',
    })

    it('403s an unverified user on an ordinary route', async () => {
      resolveUserPrincipalFromTokenMock.mockResolvedValue(UNVERIFIED)
      const { withUser } = await import('../with-auth')

      let reached = false
      const handler = withUser(async () => {
        reached = true
        return new Response('ok')
      })

      const response = await handler(requestWith('Bearer jwt.token.here'), emptyCtx)

      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ message: 'Email verification required' })
      expect(reached).toBe(false)
    })

    it('runs the handler for an unverified user on a route that opts out', async () => {
      resolveUserPrincipalFromTokenMock.mockResolvedValue(UNVERIFIED)
      const { withUser } = await import('../with-auth')

      const handler = withUser({ allowUnverified: true }, async () => new Response('reached'))

      const response = await handler(requestWith('Bearer jwt.token.here'), emptyCtx)

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('reached')
    })

    it('runs the handler for a verified user', async () => {
      resolveUserPrincipalFromTokenMock.mockResolvedValue(USER)
      const { withUser } = await import('../with-auth')

      const handler = withUser(async () => new Response('reached'))

      expect(await (await handler(requestWith('Bearer jwt'), emptyCtx)).text()).toBe('reached')
    })

    /** 401 still wins: an unauthenticated caller is not "unverified". */
    it('still 401s an absent credential rather than 403ing it', async () => {
      const { withUser } = await import('../with-auth')
      const handler = withUser(async () => new Response('ok'))

      expect((await handler(requestWith(), emptyCtx)).status).toBe(401)
    })

    it('passes the opted-out principal through unchanged', async () => {
      resolveUserPrincipalFromTokenMock.mockResolvedValue(UNVERIFIED)
      const { withUser } = await import('../with-auth')

      let seen: unknown
      const handler = withUser({ allowUnverified: true }, async (_req, principal) => {
        seen = principal
        return new Response('ok')
      })

      await handler(requestWith('Bearer jwt'), emptyCtx)
      expect(seen).toEqual(UNVERIFIED)
    })
  })

  describe('when the deployment does not require verification', () => {
    withConfigEnv({ ENABLE_EMAIL_VERIFICATION: undefined })

    it('runs the handler for an unverified user', async () => {
      resolveUserPrincipalFromTokenMock.mockResolvedValue(UNVERIFIED)
      const { withUser } = await import('../with-auth')

      const handler = withUser(async () => new Response('reached'))

      const response = await handler(requestWith('Bearer jwt.token.here'), emptyCtx)
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('reached')
    })
  })
})

describe('withApiKey', () => {
  beforeEach(() => vi.resetAllMocks())

  it('rejects a JWT without attempting a key lookup', async () => {
    const { withApiKey } = await import('../with-auth')
    const handler = withApiKey({ scopes: ['email_inboxes:read'] }, async () => new Response('ok'))

    const response = await handler(requestWith('Bearer eyJhbGciOiJIUzI1NiJ9.x.y'), emptyCtx)

    expect(response.status).toBe(401)
    expect(resolveApiKeyPrincipalMock).not.toHaveBeenCalled()
  })

  it('403s when a required scope is missing', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue({ ...KEY, scopes: ['email_inboxes:read'] })
    const { withApiKey } = await import('../with-auth')
    const handler = withApiKey({ scopes: ['email_messages:read'] }, async () => new Response('ok'))

    const response = await handler(requestWith('Bearer sk_live_abcdef123456'), emptyCtx)

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      message: 'Missing required scope: email_messages:read',
    })
  })

  it('passes the key principal when scopes are satisfied', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    const { withApiKey } = await import('../with-auth')

    let seen: unknown
    const handler = withApiKey({ scopes: ['email_messages:read'] }, async (_req, principal) => {
      seen = principal
      return new Response('ok')
    })

    await handler(requestWith('Bearer sk_live_abcdef123456'), emptyCtx)
    expect(seen).toEqual(KEY)
  })

  it('401s for an unknown or revoked key', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(null)
    const { withApiKey } = await import('../with-auth')
    const handler = withApiKey({ scopes: ['email_inboxes:read'] }, async () => new Response('ok'))

    const response = await handler(requestWith('Bearer sk_live_abcdef123456'), emptyCtx)
    expect(response.status).toBe(401)
  })

  it('accepts a key still holding a pre-rename scope', async () => {
    // The migration that rewrites api_keys.scopes does not land atomically with
    // this deploy. Without the alias, every request from an un-migrated key
    // 403s for the duration of the rollout.
    resolveApiKeyPrincipalMock.mockResolvedValue({ ...KEY, scopes: ['inboxes:read'] })
    const { withApiKey } = await import('../with-auth')
    const handler = withApiKey({ scopes: ['email_inboxes:read'] }, async () => new Response('ok'))

    const response = await handler(requestWith('Bearer sk_live_abcdef123456'), emptyCtx)
    expect(response.status).toBe(200)
  })

  it('does not let a legacy read scope satisfy any mutating scope', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue({
      ...KEY,
      scopes: ['inboxes:read', 'messages:read'],
    })
    const { withApiKey } = await import('../with-auth')

    for (const scope of ['email_inboxes:create', 'email_inboxes:update', 'email_inboxes:delete'] as const) {
      const handler = withApiKey({ scopes: [scope] }, async () => new Response('ok'))
      const response = await handler(requestWith('Bearer sk_live_abcdef123456'), emptyCtx)
      expect(response.status).toBe(403)
    }
  })

  it('does not let one mutating scope satisfy another', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue({ ...KEY, scopes: ['email_inboxes:create'] })
    const { withApiKey } = await import('../with-auth')
    const handler = withApiKey({ scopes: ['email_inboxes:delete'] }, async () => new Response('ok'))

    const response = await handler(requestWith('Bearer sk_live_abcdef123456'), emptyCtx)
    expect(response.status).toBe(403)
  })

  it('reports the current scope name when an un-migrated key lacks it', async () => {
    // The holder cannot act on `inboxes:read` — it is not a name they can ask
    // for any more. Naming the stored value would send them looking for a
    // scope the dashboard no longer offers.
    resolveApiKeyPrincipalMock.mockResolvedValue({ ...KEY, scopes: ['inboxes:read'] })
    const { withApiKey } = await import('../with-auth')
    const handler = withApiKey({ scopes: ['email_messages:read'] }, async () => new Response('ok'))

    const response = await handler(requestWith('Bearer sk_live_abcdef123456'), emptyCtx)
    expect(await response.json()).toEqual({
      message: 'Missing required scope: email_messages:read',
    })
  })
})

describe('wrapper tags', () => {
  it('tags each wrapper distinctly', async () => {
    const { withUser, withApiKey, withPublic } = await import('../with-auth')
    const { getHandlerTag } = await import('../route-tags')

    const noop = async () => new Response('ok')

    expect(getHandlerTag(withUser(noop))).toBe('user')
    expect(getHandlerTag(withApiKey({ scopes: [] }, noop))).toBe('apiKey')
    expect(getHandlerTag(withPublic(noop))).toBe('public')
  })

  /**
   * The flag is what `lib/__tests__/route-guards.test.ts` reads to pin the
   * opt-out allowlist. Only the wrapper can set it, which is the whole reason
   * the guard is trustworthy — source text can claim anything.
   */
  it('records the verification opt-out only when it was actually requested', async () => {
    const { withUser } = await import('../with-auth')
    const { getHandlerTagInfo } = await import('../route-tags')

    const noop = async () => new Response('ok')

    expect(getHandlerTagInfo(withUser(noop))).toEqual({ tag: 'user', allowUnverified: false })
    expect(getHandlerTagInfo(withUser({ allowUnverified: true }, noop))).toEqual({
      tag: 'user',
      allowUnverified: true,
    })
  })
})

describe('withPublic', () => {
  it('invokes the handler with no credential', async () => {
    const { withPublic } = await import('../with-auth')
    const handler = withPublic(async () => new Response('reached'))

    const response = await handler(requestWith(), emptyCtx)
    expect(await response.text()).toBe('reached')
  })
})

/**
 * The plan gate on the external API surface (issue #117 §6b).
 *
 * A key is bound to exactly one organization, so unlike a user session there is
 * never ambiguity about whose plan applies.
 */
describe('withApiKey plan gate', () => {
  beforeEach(() => vi.resetAllMocks())

  async function configure(overrides: { apiV1Access?: boolean }, quotaAllowed = true) {
    const { CommercialProvider } = await import('@/lib/commercial/provider')
    const { UNLIMITED } = await import('@/lib/commercial/plan-limits')
    const consume = vi.fn().mockResolvedValue({
      allowed: quotaAllowed,
      limit: 1000,
      used: quotaAllowed ? 1 : 1000,
      resetsAt: null,
    })
    CommercialProvider.configure(
      {
        resolve: async () => ({
          planCode: 'free',
          planName: 'Free',
          limits: { ...UNLIMITED, ...overrides },
          periodStart: null,
          periodEnd: null,
        }),
      },
      { consume, refund: vi.fn(), peek: vi.fn(), increment: vi.fn() },
      CommercialProvider.metering,
    )
    return { consume, CommercialProvider }
  }

  it('reaches the handler under the unlimited OSS default', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    const { withApiKey } = await import('../with-auth')
    const handler = withApiKey({ scopes: [] }, async () => new Response('reached'))

    const response = await handler(requestWith('Bearer sk_live_abc'), emptyCtx)

    expect(await response.text()).toBe('reached')
  })

  it('402s when the plan excludes API access', async () => {
    const { CommercialProvider } = await configure({ apiV1Access: false })
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    const { withApiKey } = await import('../with-auth')
    const handler = withApiKey({ scopes: [] }, async () => new Response('reached'))

    const response = await handler(requestWith('Bearer sk_live_abc'), emptyCtx)

    expect(response.status).toBe(402)
    CommercialProvider.reset()
  })

  it('402s when the API request meter is exhausted', async () => {
    const { CommercialProvider } = await configure({ apiV1Access: true }, false)
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    const { withApiKey } = await import('../with-auth')
    const handler = withApiKey({ scopes: [] }, async () => new Response('reached'))

    const response = await handler(requestWith('Bearer sk_live_abc'), emptyCtx)
    const body = await response.json()

    expect(response.status).toBe(402)
    expect(body.used).toBe(1000)
    CommercialProvider.reset()
  })

  /**
   * Ordering matters: a missing scope is an authorization failure and must
   * answer 403, never 402. Otherwise a plan limit becomes the thing that tells
   * a caller their key lacked a scope.
   */
  it('answers 403 for a missing scope before consulting the plan', async () => {
    const { consume, CommercialProvider } = await configure({ apiV1Access: false })
    resolveApiKeyPrincipalMock.mockResolvedValue({ ...KEY, scopes: [] })
    const { withApiKey } = await import('../with-auth')
    const handler = withApiKey(
      { scopes: ['email_inboxes:read'] },
      async () => new Response('reached'),
    )

    const response = await handler(requestWith('Bearer sk_live_abc'), emptyCtx)

    expect(response.status).toBe(403)
    expect(consume).not.toHaveBeenCalled()
    CommercialProvider.reset()
  })
})
