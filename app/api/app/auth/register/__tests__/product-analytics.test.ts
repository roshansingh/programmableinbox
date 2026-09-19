/**
 * user_signed_up (issue tracked in lib/product-analytics/capture.ts), fired
 * from POST /api/app/auth/register.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { withConfigEnv } from '@/test/config'

const userFindUniqueMock = vi.fn()
const transactionMock = vi.fn()
const sendVerificationEmailMock = vi.fn()
const captureEventMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => userFindUniqueMock(...args),
    },
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}))

vi.mock('@/lib/email/verification-email', () => ({
  sendVerificationEmail: (...args: unknown[]) => sendVerificationEmailMock(...args),
}))

vi.mock('@/lib/product-analytics/capture', () => ({
  captureEvent: (...args: unknown[]) => captureEventMock(...args),
  PRODUCT_ANALYTICS_EVENTS: { userSignedUp: 'user_signed_up' },
}))

const CREATED_USER = {
  id: 'u1',
  email: 'new@example.com',
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

const ctx = { params: Promise.resolve({}) }

function request(overrides: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/app/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'new@example.com',
      password: 'password123',
      firstName: 'New',
      lastName: 'User',
      ...overrides,
    }),
  })
}

async function register(overrides: Record<string, unknown> = {}) {
  const { POST } = await import('../route')
  return POST(request(overrides), ctx)
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
  userFindUniqueMock.mockResolvedValue(null)
  transactionMock.mockResolvedValue(CREATED_USER)
})

describe('product analytics disabled (the default)', () => {
  // Unrelated to what this suite tests, but the route now unconditionally
  // checks the submitted email against EMAIL_INBOX_ALLOWED_DOMAINS; a domain
  // that doesn't match 'new@example.com' keeps it inert here.
  withConfigEnv({
    PRODUCT_ANALYTICS_ENABLED: 'false',
    EMAIL_VERIFICATION_ENABLED: undefined,
    EMAIL_INBOX_ALLOWED_DOMAINS: 'owned.example.org',
  })

  it('registers the user without capturing anything', async () => {
    const response = await register()

    expect(response.status).toBe(200)
    expect(captureEventMock).not.toHaveBeenCalled()
  })
})

describe('product analytics enabled', () => {
  withConfigEnv({
    PRODUCT_ANALYTICS_ENABLED: 'true',
    POSTHOG_API_KEY: 'phc_test1234567890',
    POSTHOG_HOST: 'https://us.i.posthog.com',
    EMAIL_VERIFICATION_ENABLED: undefined,
    EMAIL_INBOX_ALLOWED_DOMAINS: 'owned.example.org',
  })

  it('captures user_signed_up with the new user as distinct_id', async () => {
    const response = await register()

    expect(response.status).toBe(200)
    expect(captureEventMock).toHaveBeenCalledWith(
      'user_signed_up',
      'u1',
      expect.objectContaining({ email: 'new@example.com' }),
    )
  })

  it('does not capture when registration is rejected for an existing account', async () => {
    userFindUniqueMock.mockResolvedValue(CREATED_USER)

    const response = await register()

    expect(response.status).toBe(409)
    expect(captureEventMock).not.toHaveBeenCalled()
  })

  it('does not capture when the request is rejected for bad input', async () => {
    const response = await register({ password: undefined })

    expect(response.status).toBe(400)
    expect(captureEventMock).not.toHaveBeenCalled()
  })
})
