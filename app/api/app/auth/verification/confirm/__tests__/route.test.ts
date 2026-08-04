import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import jwt from 'jsonwebtoken'
import { withConfigEnv, setConfigEnv } from '@/test/config'

const userFindUniqueMock = vi.fn()
const userUpdateMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => userFindUniqueMock(...args),
      update: (...args: unknown[]) => userUpdateMock(...args),
    },
  },
}))

vi.mock('@/lib/logger', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const SECRET = 'verification-secret-at-least-16'
const ENABLED = {
  ENABLE_EMAIL_VERIFICATION: 'true',
  EMAIL_VERIFICATION_SECRET: SECRET,
  APP_BASE_URL: 'https://app.example.com',
}

function tokenFor(
  claims: Record<string, unknown> = { purpose: 'email_verify', userId: 'u1', email: 'a@b.com' },
  options: jwt.SignOptions = { expiresIn: '24h' },
  secret = SECRET,
) {
  return jwt.sign(claims, secret, options)
}

function request(body: unknown) {
  return new NextRequest('http://localhost/api/app/auth/verification/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const ctx = { params: Promise.resolve({}) }

async function post(body: unknown) {
  const { POST } = await import('../route')
  return POST(request(body), ctx)
}

describe('POST /api/app/auth/verification/confirm', () => {
  describe('with verification enabled', () => {
    withConfigEnv(ENABLED)

    beforeEach(() => {
      vi.resetAllMocks()
      vi.resetModules()
    })

    it('verifies an unverified user and reports success', async () => {
      userFindUniqueMock.mockResolvedValue({ id: 'u1', email: 'a@b.com', emailVerified: false })
      userUpdateMock.mockResolvedValue({ id: 'u1' })

      const response = await post({ token: tokenFor() })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ data: { verified: true } })
      expect(userUpdateMock).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { emailVerified: true },
      })
    })

    /**
     * A mail scanner or link preview pre-fetches the URL before the human ever
     * clicks it, so the second redemption is the *common* case, not an edge
     * one. It must not show a failure.
     */
    it('is an idempotent success no-op for an already-verified user', async () => {
      userFindUniqueMock.mockResolvedValue({ id: 'u1', email: 'a@b.com', emailVerified: true })

      const response = await post({ token: tokenFor() })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ data: { verified: true } })
      expect(userUpdateMock).not.toHaveBeenCalled()
    })

    it('rejects a token issued for an address the user no longer has', async () => {
      userFindUniqueMock.mockResolvedValue({
        id: 'u1',
        email: 'changed@b.com',
        emailVerified: false,
      })

      const response = await post({ token: tokenFor() })

      expect(response.status).toBe(400)
      expect((await response.json()).message).toBe('This link is no longer valid')
      expect(userUpdateMock).not.toHaveBeenCalled()
    })

    it('reports an expired link distinctly so the client can offer a new one', async () => {
      const response = await post({
        token: tokenFor(
          { purpose: 'email_verify', userId: 'u1', email: 'a@b.com' },
          { expiresIn: '-1s' },
        ),
      })

      expect(response.status).toBe(400)
      expect((await response.json()).message).toBe('This verification link has expired')
      expect(userFindUniqueMock).not.toHaveBeenCalled()
    })

    it('rejects a token signed with the session secret', async () => {
      const response = await post({
        token: tokenFor(
          { purpose: 'email_verify', userId: 'u1', email: 'a@b.com' },
          { expiresIn: '24h' },
          'test-jwt-secret-at-least-16-chars',
        ),
      })

      expect(response.status).toBe(400)
      expect((await response.json()).message).toBe('This verification link is invalid')
      expect(userFindUniqueMock).not.toHaveBeenCalled()
    })

    it('rejects a correctly-signed token carrying the wrong purpose', async () => {
      const response = await post({
        token: tokenFor({ purpose: 'password_reset', userId: 'u1', email: 'a@b.com' }),
      })

      expect(response.status).toBe(400)
      expect((await response.json()).message).toBe('This verification link is invalid')
    })

    it('rejects a missing, blank or non-string token', async () => {
      for (const body of [{}, { token: '' }, { token: 42 }]) {
        const response = await post(body)
        expect(response.status).toBe(400)
        expect((await response.json()).message).toBe('This verification link is invalid')
      }
    })

    it('rejects a body that is not JSON without throwing', async () => {
      const { POST } = await import('../route')
      const response = await POST(
        new NextRequest('http://localhost/api/app/auth/verification/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'not json',
        }),
        ctx,
      )

      expect(response.status).toBe(400)
    })

    /**
     * Deliberately the same message and status as a bad signature. A
     * distinguishable response would make this endpoint an account-existence
     * oracle for anyone able to forge a plausible token shape.
     */
    it('gives a deleted user the same answer as an invalid token', async () => {
      userFindUniqueMock.mockResolvedValue(null)

      const response = await post({ token: tokenFor() })

      expect(response.status).toBe(400)
      expect((await response.json()).message).toBe('This verification link is invalid')
    })
  })

  describe('with verification disabled', () => {
    withConfigEnv({ ENABLE_EMAIL_VERIFICATION: undefined })

    beforeEach(() => {
      vi.resetAllMocks()
      vi.resetModules()
    })

    it('404s — the route is not a feature this deployment has', async () => {
      const response = await post({ token: 'anything' })

      expect(response.status).toBe(404)
      expect(userFindUniqueMock).not.toHaveBeenCalled()
    })

    /**
     * The 404 must come before any token work: with the flag off there is no
     * EMAIL_VERIFICATION_SECRET to verify against, and reaching the verifier
     * would throw a ConfigError and turn this into a 500.
     */
    it('404s even when the secret is absent entirely', async () => {
      setConfigEnv({ EMAIL_VERIFICATION_SECRET: undefined, APP_BASE_URL: undefined })

      const response = await post({ token: 'anything' })
      expect(response.status).toBe(404)
    })
  })
})
