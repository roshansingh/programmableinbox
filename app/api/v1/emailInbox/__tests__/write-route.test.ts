import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const resolveApiKeyPrincipalMock = vi.fn()
const createInboxMock = vi.fn()

vi.mock('@/lib/auth/api-key-auth', () => ({
  resolveApiKeyPrincipal: (...a: unknown[]) => resolveApiKeyPrincipalMock(...a),
}))

vi.mock('@/lib/services/email-inbox', () => ({
  listInboxes: vi.fn(),
  createInbox: (...a: unknown[]) => createInboxMock(...a),
}))

const KEY = {
  kind: 'apiKey',
  apiKeyId: 'key_1',
  organizationId: 'org_1',
  userId: 'user_1',
  scopes: ['email_inboxes:read', 'email_messages:read', 'email_inboxes:create'],
}

const INBOX = {
  id: 'inbox_1',
  organizationId: 'org_1',
  userId: 'user_1',
  email: 'new@mail.programmableinbox.com',
  name: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  deletedAt: null,
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost:4000/api/v1/emailInbox', {
    method: 'POST',
    headers: {
      authorization: 'Bearer sk_live_abcdef123456',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

const ctx = { params: Promise.resolve({}) }

describe('POST /api/v1/emailInbox', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
  })

  it('rejects a JWT', async () => {
    const { POST } = await import('../route')
    const request = new NextRequest('http://localhost:4000/api/v1/emailInbox', {
      method: 'POST',
      headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.x.y' },
      body: '{}',
    })

    expect((await POST(request, ctx)).status).toBe(401)
    expect(resolveApiKeyPrincipalMock).not.toHaveBeenCalled()
  })

  it('403s a read-only key without reaching the service', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue({
      ...KEY,
      scopes: ['email_inboxes:read', 'email_messages:read'],
    })
    const { POST } = await import('../route')

    const response = await POST(postRequest({ email: INBOX.email }), ctx)

    expect(response.status).toBe(403)
    expect(createInboxMock).not.toHaveBeenCalled()
  })

  it('creates an inbox in the key organization and returns 201', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    createInboxMock.mockResolvedValue({ inbox: INBOX })
    const { POST } = await import('../route')

    const response = await POST(postRequest({ email: INBOX.email, name: 'QA' }), ctx)

    expect(response.status).toBe(201)
    expect(createInboxMock).toHaveBeenCalledWith(
      { organizationId: 'org_1', userId: 'user_1' },
      { email: INBOX.email, name: 'QA' },
    )
  })

  it('serializes through the public shape, never the app one', async () => {
    // The external surface must not leak internal fields — the same reason the
    // GET on this route has a serializer of its own.
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    createInboxMock.mockResolvedValue({ inbox: INBOX })
    const { POST } = await import('../route')

    const body = await (await POST(postRequest({ email: INBOX.email }), ctx)).json()

    expect(body.data).toEqual({
      id: 'inbox_1',
      organizationId: 'org_1',
      email: INBOX.email,
      name: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('takes the organization from the key when the body omits one', async () => {
    // A key is bound to exactly one organization, so the caller never has to
    // supply it — and the write still lands somewhere specific.
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    createInboxMock.mockResolvedValue({ inbox: INBOX })
    const { POST } = await import('../route')

    await POST(postRequest({ email: INBOX.email }), ctx)

    expect(createInboxMock.mock.calls[0][0].organizationId).toBe('org_1')
  })

  it('ignores an organizationId in the body, whatever its value', async () => {
    // Not read at all — an API key is bound to exactly one organization, so
    // there is nothing to resolve from the body, matching the GET listing
    // endpoint's organizationId-less contract.
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    createInboxMock.mockResolvedValue({ inbox: INBOX })
    const { POST } = await import('../route')

    const response = await POST(
      postRequest({ email: INBOX.email, organizationId: 'org_2' }),
      ctx,
    )

    expect(response.status).toBe(201)
    expect(createInboxMock.mock.calls[0][0].organizationId).toBe('org_1')
  })

  it('passes the service rejection through with its own status', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    createInboxMock.mockResolvedValue({
      error: { message: 'Email address is not available', status: 409 },
    })
    const { POST } = await import('../route')

    const response = await POST(postRequest({ email: INBOX.email }), ctx)

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ message: 'Email address is not available' })
  })

  it('400s a malformed body rather than throwing', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    const { POST } = await import('../route')

    const request = new NextRequest('http://localhost:4000/api/v1/emailInbox', {
      method: 'POST',
      headers: {
        authorization: 'Bearer sk_live_abcdef123456',
        'content-type': 'application/json',
      },
      body: 'not json',
    })

    expect((await POST(request, ctx)).status).toBe(400)
  })

  it('500s an unexpected service failure without leaking it', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    createInboxMock.mockRejectedValue(new Error('connection reset'))
    const { POST } = await import('../route')

    const response = await POST(postRequest({ email: INBOX.email }), ctx)

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ message: 'Internal server error' })
  })
})

describe('DELETE is not part of the external surface', () => {
  it('exports no DELETE handler on the collection route', async () => {
    // Deletion targets one inbox and lives on the [id] route. A collection-level
    // DELETE would be a bulk destroy of every address in an organization.
    const route = await import('../route')
    expect('DELETE' in route).toBe(false)
  })

  it('403s a key holding update but not create', async () => {
    // The point of splitting the write scope: these are separate grants.
    resolveApiKeyPrincipalMock.mockResolvedValue({
      ...KEY,
      scopes: ['email_inboxes:read', 'email_inboxes:update'],
    })
    const { POST } = await import('../route')

    const response = await POST(postRequest({ email: INBOX.email }), ctx)

    expect(response.status).toBe(403)
    expect(createInboxMock).not.toHaveBeenCalled()
  })
})
