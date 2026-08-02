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
  scopes: ['inboxes:read', 'messages:read'],
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
      EMAIL_VERIFICATION_SECRET: 'verification-secret-at-least-16',
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
    const handler = withApiKey({ scopes: ['inboxes:read'] }, async () => new Response('ok'))

    const response = await handler(requestWith('Bearer eyJhbGciOiJIUzI1NiJ9.x.y'), emptyCtx)

    expect(response.status).toBe(401)
    expect(resolveApiKeyPrincipalMock).not.toHaveBeenCalled()
  })

  it('403s when a required scope is missing', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue({ ...KEY, scopes: ['inboxes:read'] })
    const { withApiKey } = await import('../with-auth')
    const handler = withApiKey({ scopes: ['messages:read'] }, async () => new Response('ok'))

    const response = await handler(requestWith('Bearer sk_live_abcdef123456'), emptyCtx)

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ message: 'Missing required scope: messages:read' })
  })

  it('passes the key principal when scopes are satisfied', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    const { withApiKey } = await import('../with-auth')

    let seen: unknown
    const handler = withApiKey({ scopes: ['messages:read'] }, async (_req, principal) => {
      seen = principal
      return new Response('ok')
    })

    await handler(requestWith('Bearer sk_live_abcdef123456'), emptyCtx)
    expect(seen).toEqual(KEY)
  })

  it('401s for an unknown or revoked key', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(null)
    const { withApiKey } = await import('../with-auth')
    const handler = withApiKey({ scopes: ['inboxes:read'] }, async () => new Response('ok'))

    const response = await handler(requestWith('Bearer sk_live_abcdef123456'), emptyCtx)
    expect(response.status).toBe(401)
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
