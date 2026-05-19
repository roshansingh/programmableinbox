import { beforeEach, describe, expect, it, vi } from 'vitest'

const emailInboxFindUniqueMock = vi.fn()
const emailMessageFindUniqueMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    emailInbox: {
      findUnique: (...args: unknown[]) => emailInboxFindUniqueMock(...args),
    },
    emailMessage: {
      findUnique: (...args: unknown[]) => emailMessageFindUniqueMock(...args),
    },
  },
}))

async function loadModule() {
  return await import('../authorization')
}

async function getErrorBody(response: Response) {
  return await response.json()
}

describe('authorization helpers', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
  })

  it('allows JWT user principals through requireScope without scope checks', async () => {
    const { requireScope } = await loadModule()

    const result = requireScope(
      {
        kind: 'user',
        userId: 'user_1',
        email: 'person@example.com',
        memberships: [{ organizationId: 'org_1', role: 'owner' }],
      },
      'messages:read'
    )

    expect(result).toEqual({ scope: 'messages:read' })
  })

  it('rejects API keys that lack the requested scope', async () => {
    const { requireScope } = await loadModule()

    const result = requireScope(
      {
        kind: 'apiKey',
        apiKeyId: 'key_1',
        organizationId: 'org_1',
        scopes: ['inboxes:read'],
      },
      'messages:read'
    )

    expect(result).toHaveProperty('error')
    const body = await getErrorBody(result.error)

    expect(result.error.status).toBe(403)
    expect(body.message).toBe('Missing required scope: messages:read')
  })

  it('requires organization membership for JWT user principals', async () => {
    const { requireOrgAccess } = await loadModule()

    const result = requireOrgAccess(
      {
        kind: 'user',
        userId: 'user_1',
        email: 'person@example.com',
        memberships: [{ organizationId: 'org_1', role: 'owner' }],
      },
      'org_2'
    )

    expect(result).toHaveProperty('error')
    const body = await getErrorBody(result.error)

    expect(result.error.status).toBe(403)
    expect(body.message).toBe('Not authorized for this organization')
  })

  it('rejects API keys for a different organization', async () => {
    const { requireOrgAccess } = await loadModule()

    const result = requireOrgAccess(
      {
        kind: 'apiKey',
        apiKeyId: 'key_1',
        organizationId: 'org_1',
        scopes: ['inboxes:read'],
      },
      'org_2'
    )

    expect(result).toHaveProperty('error')
    const body = await getErrorBody(result.error)

    expect(result.error.status).toBe(403)
    expect(body.message).toBe('Not authorized for this organization')
  })

  it('returns the inbox when an API key has inbox scope for the inbox organization', async () => {
    emailInboxFindUniqueMock.mockResolvedValue({
      id: 'inbox_1',
      organizationId: 'org_1',
      userId: 'user_1',
    })

    const { requireInboxAccess } = await loadModule()
    const result = await requireInboxAccess(
      {
        kind: 'apiKey',
        apiKeyId: 'key_1',
        organizationId: 'org_1',
        scopes: ['inboxes:read'],
      },
      'inbox_1'
    )

    expect(result).toEqual({
      inbox: {
        id: 'inbox_1',
        organizationId: 'org_1',
        userId: 'user_1',
      },
    })
    expect(emailInboxFindUniqueMock).toHaveBeenCalledWith({
      where: { id: 'inbox_1' },
      select: {
        id: true,
        organizationId: true,
        userId: true,
      },
    })
  })

  it('rejects inbox access before querying when the API key lacks inbox scope', async () => {
    const { requireInboxAccess } = await loadModule()
    const result = await requireInboxAccess(
      {
        kind: 'apiKey',
        apiKeyId: 'key_1',
        organizationId: 'org_1',
        scopes: ['messages:read'],
      },
      'inbox_1'
    )

    expect(result).toHaveProperty('error')
    const body = await getErrorBody(result.error)

    expect(result.error.status).toBe(403)
    expect(body.message).toBe('Missing required scope: inboxes:read')
    expect(emailInboxFindUniqueMock).not.toHaveBeenCalled()
  })

  it('rejects JWT users when the inbox belongs to another organization', async () => {
    emailInboxFindUniqueMock.mockResolvedValue({
      id: 'inbox_1',
      organizationId: 'org_2',
      userId: 'user_9',
    })

    const { requireInboxAccess } = await loadModule()
    const result = await requireInboxAccess(
      {
        kind: 'user',
        userId: 'user_1',
        email: 'person@example.com',
        memberships: [{ organizationId: 'org_1', role: 'owner' }],
      },
      'inbox_1'
    )

    expect(result).toHaveProperty('error')
    const body = await getErrorBody(result.error)

    expect(result.error.status).toBe(403)
    expect(body.message).toBe('Not authorized for this organization')
  })

  it('returns the message when a JWT user belongs to the message organization', async () => {
    emailMessageFindUniqueMock.mockResolvedValue({
      id: 'message_1',
      organizationId: 'org_1',
      inboxEmailAddressId: 'inbox_1',
    })

    const { requireMessageAccess } = await loadModule()
    const result = await requireMessageAccess(
      {
        kind: 'user',
        userId: 'user_1',
        email: 'person@example.com',
        memberships: [{ organizationId: 'org_1', role: 'owner' }],
      },
      'message_1'
    )

    expect(result).toEqual({
      message: {
        id: 'message_1',
        organizationId: 'org_1',
        inboxEmailAddressId: 'inbox_1',
      },
    })
  })

  it('rejects API keys when the message belongs to another organization', async () => {
    emailMessageFindUniqueMock.mockResolvedValue({
      id: 'message_1',
      organizationId: 'org_2',
      inboxEmailAddressId: 'inbox_1',
    })

    const { requireMessageAccess } = await loadModule()
    const result = await requireMessageAccess(
      {
        kind: 'apiKey',
        apiKeyId: 'key_1',
        organizationId: 'org_1',
        scopes: ['messages:read'],
      },
      'message_1'
    )

    expect(result).toHaveProperty('error')
    const body = await getErrorBody(result.error)

    expect(result.error.status).toBe(403)
    expect(body.message).toBe('Not authorized for this organization')
  })
})
