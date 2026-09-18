/**
 * An account whose own email lives on a domain this deployment owns
 * (EMAIL_INBOX_ALLOWED_DOMAINS) is a way to mint a free inbox-shaped address
 * without going through inbox-creation policy at all — the account row
 * exists regardless of whether an EmailInbox ever gets created at it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { withConfigEnv } from '@/test/config'

const userFindUniqueMock = vi.fn()
const transactionMock = vi.fn()
const sendVerificationEmailMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => userFindUniqueMock(...args) },
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}))

vi.mock('@/lib/email/verification-email', () => ({
  sendVerificationEmail: (...args: unknown[]) => sendVerificationEmailMock(...args),
}))

vi.mock('@/lib/logger', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const CREATED_USER = {
  id: 'u1',
  email: 'new@gmail.com',
  firstName: 'New',
  lastName: 'User',
  emailVerified: false,
  memberships: [
    {
      role: 'owner',
      organization: {
        id: 'org1',
        name: 'New User',
        slug: 'new-1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
    },
  ],
}

function register(email: string) {
  return async () => {
    const { POST } = await import('../route')
    return POST(
      new NextRequest('http://localhost/api/app/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'password123', firstName: 'New', lastName: 'User' }),
      }),
      { params: Promise.resolve({}) },
    )
  }
}

describe('POST /api/app/auth/register — same-service email domain policy', () => {
  withConfigEnv({ EMAIL_INBOX_ALLOWED_DOMAINS: 'inbox.example.com', EMAIL_VERIFICATION_ENABLED: undefined })

  beforeEach(() => {
    vi.resetAllMocks()
    userFindUniqueMock.mockResolvedValue(null)
    transactionMock.mockResolvedValue(CREATED_USER)
  })

  it('rejects registration with an email on a domain this deployment owns', async () => {
    const response = await register('someone@inbox.example.com')()

    expect(response.status).toBe(400)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('does not reveal which domains are blocked', async () => {
    const response = await register('someone@inbox.example.com')()
    const body = await response.json()

    expect(body.message).not.toContain('inbox.example.com')
  })

  it('still allows registration with an ordinary external email', async () => {
    const response = await register('new@gmail.com')()

    expect(response.status).toBe(200)
    expect(transactionMock).toHaveBeenCalled()
  })
})
