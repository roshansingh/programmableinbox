import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import jwt from 'jsonwebtoken'
import { withConfigEnv } from '@/test/config'

const findUniqueMock = vi.fn()
const updateMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
    },
  },
}))

vi.mock('@/lib/logger', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const LINK_SECRET = 'email-link-secret-at-least-16-chars'
const ENABLED = {
  ENABLE_EMAIL_VERIFICATION: 'true',
  EMAIL_LINK_SECRET: LINK_SECRET,
  APP_BASE_URL: 'https://app.example.com',
}

const HASH = '$2b$10$abcdefghijklmnopqrstuv'
const ctx = { params: Promise.resolve({}) }

function request(body: unknown) {
  return new NextRequest('http://localhost/api/app/auth/password-reset/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function post(body: unknown) {
  const { POST } = await import('../route')
  return POST(request(body), ctx)
}

async function tokenFor(overrides: Record<string, unknown> = {}, expiresIn: string | number = '30m') {
  const { passwordFingerprint } = await import('@/lib/auth/password-reset-token')
  return jwt.sign(
    {
      purpose: 'password_reset',
      userId: 'user_1',
      email: 'user@example.com',
      pwh: passwordFingerprint(HASH),
      ...overrides,
    },
    LINK_SECRET,
    { expiresIn },
  )
}

const USER = { id: 'user_1', email: 'user@example.com', passwordHash: HASH }

function resetMocks() {
  findUniqueMock.mockReset()
  updateMock.mockReset()
  updateMock.mockResolvedValue({})
  findUniqueMock.mockResolvedValue(USER)
}

describe('POST /api/app/auth/password-reset/confirm — disabled', () => {
  withConfigEnv({ ENABLE_EMAIL_VERIFICATION: 'false' })
  beforeEach(resetMocks)

  it('404s when the feature is disabled', async () => {
    expect((await post({ token: 'x', password: 'abcdefgh' })).status).toBe(404)
  })
})

describe('POST /api/app/auth/password-reset/confirm', () => {
  withConfigEnv(ENABLED)
  beforeEach(resetMocks)

  it('resets the password, stamps passwordChangedAt, and clears the cooldown', async () => {
    const response = await post({ token: await tokenFor(), password: 'new-password-1' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { reset: true } })

    const args = updateMock.mock.calls[0][0]
    expect(args.where).toEqual({ id: 'user_1' })
    expect(args.data.passwordChangedAt).toBeInstanceOf(Date)
    expect(args.data.passwordResetEmailSentAt).toBeNull()
    expect(args.data.passwordHash).not.toBe('new-password-1')
    expect(args.data.passwordHash).toMatch(/^\$2[aby]\$/)
  })

  it('never returns a session token', async () => {
    const body = await (
      await post({ token: await tokenFor(), password: 'new-password-1' })
    ).json()

    expect(JSON.stringify(body)).not.toContain('token')
  })

  it('distinguishes an expired link from an invalid one', async () => {
    const expired = await post({ token: await tokenFor({}, -10), password: 'new-password-1' })
    expect(expired.status).toBe(400)
    expect((await expired.json()).message).toMatch(/expired/i)

    const invalid = await post({ token: 'not-a-jwt', password: 'new-password-1' })
    expect((await invalid.json()).message).not.toMatch(/expired/i)
  })

  it('rejects a token whose pwh no longer matches — the link was already used', async () => {
    findUniqueMock.mockResolvedValue({ ...USER, passwordHash: '$2b$10$adifferenthashvalue' })

    const response = await post({ token: await tokenFor(), password: 'new-password-1' })

    expect(response.status).toBe(400)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('rejects the same token replayed against the hash the route actually wrote', async () => {
    // The test above asserts single-use by hand-substituting a different
    // hash — it never exercises the real chain: hashPassword bcrypt-salts
    // per call, so the fingerprint the route computed against the NEW hash
    // differs from `pwh` on the still-valid-looking token. Round-trip the
    // actual write here instead of a stand-in.
    const token = await tokenFor()

    const first = await post({ token, password: 'new-password-1' })
    expect(first.status).toBe(200)
    expect(updateMock).toHaveBeenCalledTimes(1)

    const writtenHash = updateMock.mock.calls[0][0].data.passwordHash
    findUniqueMock.mockResolvedValue({ ...USER, passwordHash: writtenHash })

    const replay = await post({ token, password: 'new-password-1' })

    expect(replay.status).toBe(400)
    expect(updateMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a token whose email no longer matches the row', async () => {
    findUniqueMock.mockResolvedValue({ ...USER, email: 'moved@example.com' })

    const response = await post({ token: await tokenFor(), password: 'new-password-1' })

    expect(response.status).toBe(400)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('rejects a weak password before touching the row', async () => {
    const response = await post({ token: await tokenFor(), password: 'short' })

    expect(response.status).toBe(400)
    expect((await response.json()).message).toMatch(/at least 8/)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('gives a deleted user the same message as an invalid token', async () => {
    findUniqueMock.mockResolvedValue(null)

    const missing = await post({ token: await tokenFor(), password: 'new-password-1' })
    const invalid = await post({ token: 'not-a-jwt', password: 'new-password-1' })

    expect((await missing.json()).message).toBe((await invalid.json()).message)
  })

  it('rejects a verification token presented here', async () => {
    const { signVerificationToken } = await import('@/lib/auth/verification-token')

    const response = await post({
      token: signVerificationToken({ userId: 'user_1', email: 'user@example.com' }),
      password: 'new-password-1',
    })

    expect(response.status).toBe(400)
    expect(updateMock).not.toHaveBeenCalled()
  })
})
