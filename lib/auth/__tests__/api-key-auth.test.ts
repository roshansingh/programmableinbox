import { beforeEach, describe, expect, it, vi } from 'vitest'
import crypto from 'crypto'

const apiKeyFindFirstMock = vi.fn()
const apiKeyUpdateMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    apiKey: {
      findFirst: (...args: unknown[]) => apiKeyFindFirstMock(...args),
      update: (...args: unknown[]) => apiKeyUpdateMock(...args),
    },
  },
}))

async function loadModule() {
  return await import('../api-key-auth')
}

const RAW_KEY = 'sk_live_abcd1234567890'

describe('resolveApiKeyPrincipal', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    apiKeyUpdateMock.mockResolvedValue({})
  })

  it('resolves a valid key to a principal', async () => {
    apiKeyFindFirstMock.mockResolvedValue({
      id: 'key_1',
      organizationId: 'org_1',
      userId: 'user_1',
      scopes: ['email_messages:read'],
    })

    const { resolveApiKeyPrincipal } = await loadModule()

    expect(await resolveApiKeyPrincipal(RAW_KEY)).toEqual({
      kind: 'apiKey',
      apiKeyId: 'key_1',
      organizationId: 'org_1',
      userId: 'user_1',
      scopes: ['email_messages:read'],
    })
  })

  it('selects the creating user, because an inbox row needs an owner', async () => {
    // EmailInbox.userId is NOT NULL, so a key that can create an inbox has to
    // carry a user to attribute it to. ApiKey.userId is the only defensible
    // answer — the human who minted the credential.
    apiKeyFindFirstMock.mockResolvedValue(null)

    const { resolveApiKeyPrincipal } = await loadModule()
    await resolveApiKeyPrincipal(RAW_KEY)

    const [{ select }] = apiKeyFindFirstMock.mock.calls[0] as [{ select: Record<string, boolean> }]
    expect(select.userId).toBe(true)
  })

  it('looks the key up by hash, never by the raw value', async () => {
    apiKeyFindFirstMock.mockResolvedValue(null)

    const { resolveApiKeyPrincipal } = await loadModule()
    await resolveApiKeyPrincipal(RAW_KEY)

    const where = apiKeyFindFirstMock.mock.calls[0][0].where
    expect(where.keyHash).toBe(crypto.createHash('sha256').update(RAW_KEY).digest('hex'))
    expect(JSON.stringify(where)).not.toContain(RAW_KEY)
  })

  it('excludes revoked and expired keys in the lookup itself (F5)', async () => {
    apiKeyFindFirstMock.mockResolvedValue(null)

    const { resolveApiKeyPrincipal } = await loadModule()
    await resolveApiKeyPrincipal(RAW_KEY)

    const where = apiKeyFindFirstMock.mock.calls[0][0].where
    // A revoked key must be unresolvable, not merely filtered after the fact.
    expect(where.revokedAt).toBeNull()
    // Either no expiry set, or an expiry still in the future.
    expect(where.OR).toEqual([{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }])
  })

  it('returns null when no key matches', async () => {
    apiKeyFindFirstMock.mockResolvedValue(null)

    const { resolveApiKeyPrincipal } = await loadModule()

    expect(await resolveApiKeyPrincipal(RAW_KEY)).toBeNull()
    expect(apiKeyUpdateMock).not.toHaveBeenCalled()
  })

  it('records lastUsedAt on a successful resolve', async () => {
    apiKeyFindFirstMock.mockResolvedValue({ id: 'key_1', organizationId: 'org_1', scopes: [] })

    const { resolveApiKeyPrincipal } = await loadModule()
    await resolveApiKeyPrincipal(RAW_KEY)

    expect(apiKeyUpdateMock).toHaveBeenCalledWith({
      where: { id: 'key_1' },
      data: { lastUsedAt: expect.any(Date) },
    })
  })

  it('still authenticates when the lastUsedAt write fails', async () => {
    // lastUsedAt is observability. A failure to record it must never reject a
    // request made with a valid key.
    apiKeyFindFirstMock.mockResolvedValue({ id: 'key_1', organizationId: 'org_1', scopes: [] })
    apiKeyUpdateMock.mockRejectedValue(new Error('db unavailable'))

    const { resolveApiKeyPrincipal } = await loadModule()
    const principal = await resolveApiKeyPrincipal(RAW_KEY)

    expect(principal).toMatchObject({ kind: 'apiKey', apiKeyId: 'key_1' })
    // Let the rejected fire-and-forget settle; an unhandled rejection here
    // would fail the run.
    await new Promise((resolve) => setImmediate(resolve))
  })
})
