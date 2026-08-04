import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { withConfigEnv } from '@/test/config'

const findUniqueMock = vi.fn()
const updateMock = vi.fn()
const sendMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
    },
  },
}))

vi.mock('@/lib/email/password-reset-email', () => ({
  sendPasswordResetEmail: (...args: unknown[]) => sendMock(...args),
}))

vi.mock('@/lib/logger', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const ENABLED = {
  ENABLE_EMAIL_VERIFICATION: 'true',
  EMAIL_LINK_SECRET: 'email-link-secret-at-least-16-chars',
  APP_BASE_URL: 'https://app.example.com',
}

const ctx = { params: Promise.resolve({}) }

function request(body: unknown) {
  return new NextRequest('http://localhost/api/app/auth/password-reset/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function post(body: unknown) {
  const { POST } = await import('../route')
  return POST(request(body), ctx)
}

const USER = {
  id: 'user_1',
  email: 'user@example.com',
  passwordHash: '$2b$10$abcdefghijklmnopqrstuv',
  passwordResetEmailSentAt: null,
}

function resetMocks() {
  findUniqueMock.mockReset()
  updateMock.mockReset()
  sendMock.mockReset()
  sendMock.mockResolvedValue(undefined)
  updateMock.mockResolvedValue({})
}

describe('POST /api/app/auth/password-reset/request — disabled', () => {
  withConfigEnv({ ENABLE_EMAIL_VERIFICATION: 'false' })
  beforeEach(resetMocks)

  it('404s when the feature is disabled', async () => {
    const response = await post({ email: 'user@example.com' })

    expect(response.status).toBe(404)
    expect(sendMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/app/auth/password-reset/request', () => {
  withConfigEnv(ENABLED)
  beforeEach(resetMocks)

  it('sends and stamps the cooldown for a real account', async () => {
    findUniqueMock.mockResolvedValue(USER)

    const response = await post({ email: 'user@example.com' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { requested: true } })
    expect(sendMock).toHaveBeenCalledWith({
      id: 'user_1',
      email: 'user@example.com',
      passwordHash: USER.passwordHash,
    })
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user_1' } }),
    )
  })

  it('answers identically for an account that does not exist', async () => {
    findUniqueMock.mockResolvedValue(null)

    const response = await post({ email: 'nobody@example.com' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { requested: true } })
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('answers identically when the cooldown blocks the send', async () => {
    findUniqueMock.mockResolvedValue({
      ...USER,
      passwordResetEmailSentAt: new Date(Date.now() - 5_000),
    })

    const response = await post({ email: 'user@example.com' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { requested: true } })
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('answers identically when the send fails, and does not stamp a cooldown', async () => {
    findUniqueMock.mockResolvedValue(USER)
    sendMock.mockRejectedValue(new Error('resend down'))

    const response = await post({ email: 'user@example.com' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { requested: true } })
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('sends again once the cooldown has elapsed', async () => {
    findUniqueMock.mockResolvedValue({
      ...USER,
      passwordResetEmailSentAt: new Date(Date.now() - 120_000),
    })

    await post({ email: 'user@example.com' })

    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('answers identically to a malformed body', async () => {
    const response = await post({ notAnEmail: 1 })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { requested: true } })
    expect(findUniqueMock).not.toHaveBeenCalled()
  })

  it('looks the address up case-insensitively by normalising it', async () => {
    findUniqueMock.mockResolvedValue(USER)

    await post({ email: '  USER@Example.com  ' })

    expect(findUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'user@example.com' } }),
    )
  })
})
