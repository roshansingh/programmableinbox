import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const resolveApiKeyPrincipalMock = vi.fn()
const updateInboxForWriteMock = vi.fn()

vi.mock('@/lib/auth/api-key-auth', () => ({
  resolveApiKeyPrincipal: (...a: unknown[]) => resolveApiKeyPrincipalMock(...a),
}))

vi.mock('@/lib/services/email-inbox', () => ({
  getInbox: vi.fn(),
  updateInboxForWrite: (...a: unknown[]) => updateInboxForWriteMock(...a),
}))

const KEY = {
  kind: 'apiKey',
  apiKeyId: 'key_1',
  organizationId: 'org_1',
  userId: 'user_1',
  scopes: ['email_inboxes:read', 'email_messages:read', 'email_inboxes:write'],
}

const INBOX = {
  id: 'inbox_1',
  organizationId: 'org_1',
  userId: 'user_1',
  email: 'existing@mail.programmableinbox.com',
  name: 'QA',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  deletedAt: null,
}

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost:4000/api/v1/emailInbox/inbox_1', {
    method: 'PATCH',
    headers: {
      authorization: 'Bearer sk_live_abcdef123456',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

const ctx = { params: Promise.resolve({ id: 'inbox_1' }) }

describe('PATCH /api/v1/emailInbox/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
  })

  it('rejects a JWT', async () => {
    const { PATCH } = await import('../route')
    const request = new NextRequest('http://localhost:4000/api/v1/emailInbox/inbox_1', {
      method: 'PATCH',
      headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.x.y' },
      body: '{}',
    })

    expect((await PATCH(request, ctx)).status).toBe(401)
    expect(resolveApiKeyPrincipalMock).not.toHaveBeenCalled()
  })

  it('403s a read-only key without reaching the service', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue({
      ...KEY,
      scopes: ['email_inboxes:read', 'email_messages:read'],
    })
    const { PATCH } = await import('../route')

    const response = await PATCH(patchRequest({ name: 'Renamed' }), ctx)

    expect(response.status).toBe(403)
    expect(updateInboxForWriteMock).not.toHaveBeenCalled()
  })

  it('renames through the shared service, scoped to the key organization', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    updateInboxForWriteMock.mockResolvedValue({ inbox: { ...INBOX, name: 'Renamed' } })
    const { PATCH } = await import('../route')

    const response = await PATCH(patchRequest({ name: 'Renamed' }), ctx)

    expect(response.status).toBe(200)
    expect(updateInboxForWriteMock).toHaveBeenCalledWith(
      { organizationId: 'org_1', userId: 'user_1' },
      'inbox_1',
      { email: undefined, name: 'Renamed' },
    )
  })

  it('serializes through the public shape', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    updateInboxForWriteMock.mockResolvedValue({ inbox: INBOX })
    const { PATCH } = await import('../route')

    const body = await (await PATCH(patchRequest({ name: 'QA' }), ctx)).json()

    expect(body.data).toEqual({
      id: 'inbox_1',
      organizationId: 'org_1',
      email: INBOX.email,
      name: 'QA',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    })
  })

  it('passes the address-immutability rejection through as 409', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    updateInboxForWriteMock.mockResolvedValue({
      error: {
        message: 'The address of an inbox cannot be changed. Create a new inbox instead.',
        status: 409,
      },
    })
    const { PATCH } = await import('../route')

    const response = await PATCH(patchRequest({ email: 'other@mail.programmableinbox.com' }), ctx)

    expect(response.status).toBe(409)
  })

  it('404s an inbox the scope cannot reach', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    updateInboxForWriteMock.mockResolvedValue({ error: { message: 'Not found', status: 404 } })
    const { PATCH } = await import('../route')

    expect((await PATCH(patchRequest({ name: 'x' }), ctx)).status).toBe(404)
  })

  it('400s a malformed body rather than throwing', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    const { PATCH } = await import('../route')

    const request = new NextRequest('http://localhost:4000/api/v1/emailInbox/inbox_1', {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer sk_live_abcdef123456',
        'content-type': 'application/json',
      },
      body: 'not json',
    })

    expect((await PATCH(request, ctx)).status).toBe(400)
  })

  it('500s an unexpected service failure without leaking it', async () => {
    resolveApiKeyPrincipalMock.mockResolvedValue(KEY)
    updateInboxForWriteMock.mockRejectedValue(new Error('connection reset'))
    const { PATCH } = await import('../route')

    const response = await PATCH(patchRequest({ name: 'x' }), ctx)

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ message: 'Internal server error' })
  })

  it('exports no DELETE handler', async () => {
    // Deletion permanently retires the address and stays dashboard-only.
    const route = await import('../route')
    expect('DELETE' in route).toBe(false)
  })
})
