/**
 * Ported from the v1 suite when these routes moved to /api/app.
 *
 * The OTP lookup is a read, so it is organization-scoped — matching what the
 * route already did by hand with the membership org list, now expressed through
 * toOrgScope and getInbox.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const resolveUserPrincipalFromTokenMock = vi.fn()
const emailInboxFindFirstMock = vi.fn()
const emailMessageFindFirstMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  resolveUserPrincipalFromToken: (...args: unknown[]) =>
    resolveUserPrincipalFromTokenMock(...args),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    emailInbox: {
      findFirst: (...args: unknown[]) => emailInboxFindFirstMock(...args),
      findMany: vi.fn(),
    },
    emailMessage: {
      findFirst: (...args: unknown[]) => emailMessageFindFirstMock(...args),
      findMany: vi.fn(),
    },
  },
}))

const PRINCIPAL = {
  kind: 'user' as const,
  userId: 'user_1',
  email: 'user@example.com',
  memberships: [{ organizationId: 'org_1', role: 'owner' }],
}

const TOKEN = 'Bearer header.payload.signature'

beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
  resolveUserPrincipalFromTokenMock.mockResolvedValue(PRINCIPAL)
})

async function get(id: string, authorization: string = TOKEN) {
  const { GET } = await import('../[id]/otp/route')
  return GET(
    new NextRequest(`http://localhost/api/app/emailInbox/${id}/otp`, {
      headers: authorization ? { authorization } : {},
    }),
    { params: Promise.resolve({ id }) },
  )
}

describe('GET /api/app/emailInbox/[id]/otp', () => {
  it('returns 401 when not authenticated', async () => {
    const { GET } = await import('../[id]/otp/route')
    const response = await GET(
      new NextRequest('http://localhost/api/app/emailInbox/inbox_1/otp'),
      { params: Promise.resolve({ id: 'inbox_1' }) },
    )

    expect(response.status).toBe(401)
  })

  it('returns 404 when inbox does not belong to user org', async () => {
    emailInboxFindFirstMock.mockResolvedValue(null)

    const response = await get('inbox_1')

    expect(response.status).toBe(404)
    expect(emailMessageFindFirstMock).not.toHaveBeenCalled()
  })

  it('scopes the inbox lookup to the caller organizations', async () => {
    emailInboxFindFirstMock.mockResolvedValue(null)

    await get('inbox_1')

    expect(emailInboxFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'inbox_1', organizationId: { in: ['org_1'] } },
    })
  })

  it('returns 404 when no OTP found in inbox', async () => {
    emailInboxFindFirstMock.mockResolvedValue({ id: 'inbox_1', organizationId: 'org_1' })
    emailMessageFindFirstMock.mockResolvedValue(null)

    const response = await get('inbox_1')

    expect(response.status).toBe(404)
    expect((await response.json()).message).toBe('No OTP found for this inbox')
  })

  it('returns otp, receivedAt, messageId when found', async () => {
    const createdAt = new Date('2026-01-03T00:00:00.000Z')
    emailInboxFindFirstMock.mockResolvedValue({ id: 'inbox_1', organizationId: 'org_1' })
    emailMessageFindFirstMock.mockResolvedValue({
      extractedOtp: '123456',
      createdAt,
      id: 'msg_1',
    })

    const response = await get('inbox_1')
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.otp).toBe('123456')
    expect(body.data.messageId).toBe('msg_1')
    expect(new Date(body.data.receivedAt)).toEqual(createdAt)
  })

  it('rejects an API key without attempting a lookup', async () => {
    const response = await get('inbox_1', 'Bearer sk_live_abcdef123456')

    expect(response.status).toBe(401)
    expect(resolveUserPrincipalFromTokenMock).not.toHaveBeenCalled()
    expect(emailInboxFindFirstMock).not.toHaveBeenCalled()
  })
})
