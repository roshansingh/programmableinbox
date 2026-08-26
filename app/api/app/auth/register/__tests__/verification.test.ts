import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { withConfigEnv } from '@/test/config'
import { SESSION_COOKIE_NAME } from '@/lib/auth-server'

const userFindUniqueMock = vi.fn()
const userUpdateMock = vi.fn()
const transactionMock = vi.fn()
const sendVerificationEmailMock = vi.fn()
const loggerErrorMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => userFindUniqueMock(...args),
      update: (...args: unknown[]) => userUpdateMock(...args),
    },
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}))

vi.mock('@/lib/email/verification-email', () => ({
  sendVerificationEmail: (...args: unknown[]) => sendVerificationEmailMock(...args),
}))

vi.mock('@/lib/logger', () => ({
  default: {
    warn: vi.fn(),
    error: (...args: unknown[]) => loggerErrorMock(...args),
    info: vi.fn(),
    debug: vi.fn(),
  },
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

function request() {
  return new NextRequest('http://localhost/api/app/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'new@example.com',
      password: 'password123',
      firstName: 'New',
      lastName: 'User',
    }),
  })
}

async function register() {
  const { POST } = await import('../route')
  return POST(request(), ctx)
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
  userFindUniqueMock.mockResolvedValue(null)
  transactionMock.mockResolvedValue(CREATED_USER)
  userUpdateMock.mockResolvedValue(CREATED_USER)
})

describe('POST /api/app/auth/register — Content-Type enforcement', () => {
  withConfigEnv({ ENABLE_EMAIL_VERIFICATION: undefined })

  function requestWithContentType(contentType: string | undefined) {
    const headers: Record<string, string> = {}
    if (contentType !== undefined) {
      headers['Content-Type'] = contentType
    }
    return new NextRequest('http://localhost/api/app/auth/register', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: 'new@example.com',
        password: 'password123',
        firstName: 'New',
        lastName: 'User',
      }),
    })
  }

  async function registerWithContentType(contentType: string | undefined) {
    const { POST } = await import('../route')
    return POST(requestWithContentType(contentType), ctx)
  }

  it('rejects a text/plain body with 415 before touching the database', async () => {
    // text/plain is one of the three CORS-safelisted content types, so a
    // cross-origin caller can send it with no preflight.
    const response = await registerWithContentType('text/plain')

    expect(response.status).toBe(415)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('rejects a missing Content-Type header with 415', async () => {
    const response = await registerWithContentType(undefined)
    expect(response.status).toBe(415)
  })

  it('still registers with application/json, charset suffix included', async () => {
    const response = await registerWithContentType('application/json; charset=utf-8')
    expect(response.status).toBe(200)
  })
})

describe('POST /api/app/auth/register — verification side effects', () => {
  describe('with verification enabled', () => {
    withConfigEnv({
      ENABLE_EMAIL_VERIFICATION: 'true',
      EMAIL_LINK_SECRET: 'verification-secret-at-least-16',
      APP_BASE_URL: 'https://app.example.com',
    })

    it('mails the new user and stamps the cooldown timestamp', async () => {
      sendVerificationEmailMock.mockResolvedValue(undefined)

      const response = await register()

      expect(response.status).toBe(200)
      expect(sendVerificationEmailMock).toHaveBeenCalledWith({
        id: 'u1',
        email: 'new@example.com',
      })
      expect(userUpdateMock).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { verificationEmailSentAt: expect.any(Date) },
      })
    })

    it('still sets the session cookie, so the gate screen has something to render', async () => {
      sendVerificationEmailMock.mockResolvedValue(undefined)

      const response = await register()
      const { data } = await response.json()

      expect(response.cookies.get(SESSION_COOKIE_NAME)?.value).toEqual(expect.any(String))
      expect(data.token).toBeUndefined()
      expect(data.user.email).toBe('new@example.com')
      expect(data.user.emailVerified).toBe(false)
    })

    /**
     * §7.2. The account and organization are already committed by the time the
     * mail is attempted, so a 500 here would leave the user holding an account
     * they believe does not exist and an email they cannot re-request. The
     * Resend button on the gate screen is the recovery path.
     */
    it('does not fail the signup when the send throws', async () => {
      sendVerificationEmailMock.mockRejectedValue(new Error('resend is down'))

      const response = await register()

      expect(response.status).toBe(200)
      expect(response.cookies.get(SESSION_COOKIE_NAME)?.value).toEqual(expect.any(String))
      expect(loggerErrorMock).toHaveBeenCalled()
      // No cooldown stamped for an email that never went out.
      expect(userUpdateMock).not.toHaveBeenCalled()
    })

    /**
     * The send and the stamp report separately. Sharing one catch meant a
     * failed stamp logged "Failed to send" for an email that had gone out,
     * which sends an operator looking at Resend for a fault in the database.
     */
    it('reports a failed cooldown stamp distinctly from a failed send', async () => {
      sendVerificationEmailMock.mockResolvedValue(undefined)
      userUpdateMock.mockRejectedValue(new Error('connection lost'))

      const response = await register()

      expect(response.status).toBe(200)
      expect(sendVerificationEmailMock).toHaveBeenCalled()

      const messages = loggerErrorMock.mock.calls.map((call) => call[1])
      expect(messages).toContain(
        'Sent the signup verification email but failed to record its cooldown timestamp',
      )
      expect(messages).not.toContain('Failed to send signup verification email')
    })
  })

  describe('with verification disabled', () => {
    withConfigEnv({ ENABLE_EMAIL_VERIFICATION: undefined })

    it('sends nothing and leaves the response shape untouched', async () => {
      const response = await register()

      expect(response.status).toBe(200)
      expect(sendVerificationEmailMock).not.toHaveBeenCalled()
      expect(userUpdateMock).not.toHaveBeenCalled()
      expect(response.cookies.get(SESSION_COOKIE_NAME)?.value).toEqual(expect.any(String))

      const { data } = await response.json()
      expect(data.token).toBeUndefined()
    })
  })
})
