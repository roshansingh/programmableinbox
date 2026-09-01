import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { withConfigEnv } from '@/test/config'

const resolveUserPrincipalFromTokenMock = vi.fn()
const userFindUniqueMock = vi.fn()
const userUpdateMock = vi.fn()
const sendVerificationEmailMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  resolveUserPrincipalFromToken: (...args: unknown[]) =>
    resolveUserPrincipalFromTokenMock(...args),
  SESSION_COOKIE_NAME: 'session',
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => userFindUniqueMock(...args),
      update: (...args: unknown[]) => userUpdateMock(...args),
    },
  },
}))

vi.mock('@/lib/email/verification-email', () => ({
  sendVerificationEmail: (...args: unknown[]) => sendVerificationEmailMock(...args),
}))

vi.mock('@/lib/logger', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const ENABLED = {
  ENABLE_EMAIL_VERIFICATION: 'true',
  EMAIL_LINK_SECRET: 'verification-secret-at-least-16',
  APP_BASE_URL: 'https://app.example.com',
}

const PRINCIPAL = {
  kind: 'user' as const,
  userId: 'u1',
  email: 'a@b.com',
  emailVerified: false,
  memberships: [],
}

const ctx = { params: Promise.resolve({}) }

function request(credential = 'jwt.token.here') {
  return new NextRequest('http://localhost/api/app/auth/verification/resend', {
    method: 'POST',
    headers: { cookie: `session=${credential}` },
  })
}

async function post(credential?: string) {
  const { POST } = await import('../route')
  return POST(request(credential), ctx)
}

describe('POST /api/app/auth/verification/resend', () => {
  describe('with verification enabled', () => {
    withConfigEnv(ENABLED)

    beforeEach(() => {
      vi.resetAllMocks()
      vi.resetModules()
      resolveUserPrincipalFromTokenMock.mockResolvedValue(PRINCIPAL)
    })

    it('sends and stamps the cooldown timestamp', async () => {
      userFindUniqueMock.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        emailVerified: false,
        verificationEmailSentAt: null,
      })
      sendVerificationEmailMock.mockResolvedValue(undefined)

      const response = await post()

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ data: { sent: true } })
      expect(sendVerificationEmailMock).toHaveBeenCalledWith({ id: 'u1', email: 'a@b.com' })
      expect(userUpdateMock).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { verificationEmailSentAt: expect.any(Date) },
      })
    })

    it('429s a second request inside the cooldown window', async () => {
      userFindUniqueMock.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        emailVerified: false,
        verificationEmailSentAt: new Date(Date.now() - 5_000),
      })

      const response = await post()

      expect(response.status).toBe(429)
      expect((await response.json()).message).toBe(
        'Please wait before requesting another email',
      )
      expect(sendVerificationEmailMock).not.toHaveBeenCalled()
    })

    it('sends again once the cooldown has elapsed', async () => {
      userFindUniqueMock.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        emailVerified: false,
        verificationEmailSentAt: new Date(Date.now() - 120_000),
      })
      sendVerificationEmailMock.mockResolvedValue(undefined)

      expect((await post()).status).toBe(200)
      expect(sendVerificationEmailMock).toHaveBeenCalledTimes(1)
    })

    /** Nothing to do is not an error — most often it means a second tab. */
    it('reports sent: false for an already-verified user', async () => {
      userFindUniqueMock.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        emailVerified: true,
        verificationEmailSentAt: null,
      })

      const response = await post()

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ data: { sent: false } })
      expect(sendVerificationEmailMock).not.toHaveBeenCalled()
    })

    /**
     * The timestamp is stamped only after a successful send. Stamping first
     * would mean a transient Resend outage locks the user out of retrying for
     * a minute, for an email that never went out.
     */
    it('leaves the cooldown untouched when the send fails, so a retry is possible', async () => {
      userFindUniqueMock.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        emailVerified: false,
        verificationEmailSentAt: null,
      })
      sendVerificationEmailMock.mockRejectedValue(new Error('resend is down'))

      const response = await post()

      expect(response.status).toBe(502)
      expect(userUpdateMock).not.toHaveBeenCalled()
    })

    /**
     * The mail is already away at this point; only the bookkeeping failed. A
     * 500 would misreport that to a user whose email is on its way, and invite
     * exactly the retry that produces the duplicate send the cooldown exists to
     * prevent.
     */
    it('still reports success when the cooldown stamp fails after a successful send', async () => {
      userFindUniqueMock.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        emailVerified: false,
        verificationEmailSentAt: null,
      })
      sendVerificationEmailMock.mockResolvedValue(undefined)
      userUpdateMock.mockRejectedValue(new Error('connection lost'))

      const response = await post()

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ data: { sent: true } })
    })

    it('401s without a credential, and never sends', async () => {
      const { POST } = await import('../route')
      const response = await POST(
        new NextRequest('http://localhost/api/app/auth/verification/resend', { method: 'POST' }),
        ctx,
      )

      expect(response.status).toBe(401)
      expect(sendVerificationEmailMock).not.toHaveBeenCalled()
    })

    /**
     * The whole point of `allowUnverified` on this route: without it the gate
     * would 403 the only call that can clear the gate.
     */
    it('is reachable by an unverified user despite the gate being on', async () => {
      userFindUniqueMock.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        emailVerified: false,
        verificationEmailSentAt: null,
      })
      sendVerificationEmailMock.mockResolvedValue(undefined)

      expect((await post()).status).toBe(200)
    })

    /**
     * The address comes from the principal, never the body, so this cannot be
     * aimed at a third party — it is a mail-sending primitive with exactly one
     * possible recipient.
     */
    it('ignores any address supplied by the caller', async () => {
      userFindUniqueMock.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        emailVerified: false,
        verificationEmailSentAt: null,
      })
      sendVerificationEmailMock.mockResolvedValue(undefined)

      const { POST } = await import('../route')
      await POST(
        new NextRequest('http://localhost/api/app/auth/verification/resend', {
          method: 'POST',
          headers: { cookie: 'session=jwt', 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'victim@elsewhere.com' }),
        }),
        ctx,
      )

      expect(sendVerificationEmailMock).toHaveBeenCalledWith({ id: 'u1', email: 'a@b.com' })
    })
  })

  describe('with verification disabled', () => {
    withConfigEnv({ ENABLE_EMAIL_VERIFICATION: undefined })

    beforeEach(() => {
      vi.resetAllMocks()
      vi.resetModules()
      resolveUserPrincipalFromTokenMock.mockResolvedValue(PRINCIPAL)
    })

    it('404s without touching the mailer', async () => {
      const response = await post()

      expect(response.status).toBe(404)
      expect(sendVerificationEmailMock).not.toHaveBeenCalled()
      expect(userFindUniqueMock).not.toHaveBeenCalled()
    })
  })
})
