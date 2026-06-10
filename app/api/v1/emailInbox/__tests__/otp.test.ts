import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockGetAuthenticatedUser = vi.fn()
const mockInboxFindFirst = vi.fn()
const mockMessageFindFirst = vi.fn()

vi.mock('@/lib/auth-server', () => ({ getAuthenticatedUser: mockGetAuthenticatedUser }))
vi.mock('@/lib/db', () => ({
  prisma: {
    emailInbox: { findFirst: mockInboxFindFirst },
    emailMessage: { findFirst: mockMessageFindFirst },
  },
}))

const MOCK_USER = {
  id: 'user-1',
  memberships: [{ organizationId: 'org-1' }],
}

function makeRequest(inboxId: string) {
  return new NextRequest(`http://localhost/api/v1/emailInbox/${inboxId}/otp`, {
    headers: { Authorization: 'Bearer mock-token' },
  })
}

describe('GET /api/v1/emailInbox/[id]/otp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAuthenticatedUser.mockResolvedValue(MOCK_USER)
  })

  it('returns 401 when not authenticated', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(null)
    const { GET } = await import('../[id]/otp/route')
    const res = await GET(makeRequest('inbox-1'), { params: Promise.resolve({ id: 'inbox-1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 404 when inbox does not belong to user org', async () => {
    mockInboxFindFirst.mockResolvedValue(null)
    const { GET } = await import('../[id]/otp/route')
    const res = await GET(makeRequest('inbox-1'), { params: Promise.resolve({ id: 'inbox-1' }) })
    expect(res.status).toBe(404)
  })

  it('returns 404 when no OTP found in inbox', async () => {
    mockInboxFindFirst.mockResolvedValue({ id: 'inbox-1' })
    mockMessageFindFirst.mockResolvedValue(null)
    const { GET } = await import('../[id]/otp/route')
    const res = await GET(makeRequest('inbox-1'), { params: Promise.resolve({ id: 'inbox-1' }) })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.message).toMatch(/No OTP found/)
  })

  it('returns otp, receivedAt, messageId when found', async () => {
    const now = new Date('2026-06-10T12:00:00.000Z')
    mockInboxFindFirst.mockResolvedValue({ id: 'inbox-1' })
    mockMessageFindFirst.mockResolvedValue({ extractedOtp: '987654', createdAt: now, id: 'msg-42' })
    const { GET } = await import('../[id]/otp/route')
    const res = await GET(makeRequest('inbox-1'), { params: Promise.resolve({ id: 'inbox-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.otp).toBe('987654')
    expect(body.data.messageId).toBe('msg-42')
  })
})
