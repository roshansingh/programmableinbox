import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withConfigEnv } from '@/test/config'

const sendMock = vi.fn()

vi.mock('@/lib/resend', () => ({
  getResend: () => ({ emails: { send: (...args: unknown[]) => sendMock(...args) } }),
}))

const USER = {
  id: 'user_1',
  email: 'user@example.com',
  passwordHash: '$2b$10$abcdefghijklmnopqrstuv',
}

describe('sendPasswordResetEmail', () => {
  withConfigEnv({
    ENABLE_EMAIL_VERIFICATION: 'true',
    EMAIL_LINK_SECRET: 'email-link-secret-at-least-16-chars',
    APP_BASE_URL: 'https://app.example.com',
    AUTH_EMAIL_FROM: 'noreply@example.com',
    AUTH_EMAIL_FROM_NAME: 'Programmable Inbox',
    AUTH_RESEND_API_KEY: 're_test_key',
    PASSWORD_RESET_TOKEN_TTL_MINUTES: '30',
  })

  beforeEach(() => {
    sendMock.mockReset()
    sendMock.mockResolvedValue({ error: null })
  })

  it('builds the link against APP_BASE_URL with the token as the only parameter', async () => {
    const { buildPasswordResetUrl } = await import('../password-reset-email')

    const url = new URL(buildPasswordResetUrl('tok123'))

    expect(url.origin).toBe('https://app.example.com')
    expect(url.pathname).toBe('/auth/reset-password')
    expect([...url.searchParams.keys()]).toEqual(['token'])
    expect(url.searchParams.get('token')).toBe('tok123')
  })

  it('sends to the user and states the configured expiry', async () => {
    const { sendPasswordResetEmail } = await import('../password-reset-email')

    await sendPasswordResetEmail(USER)

    expect(sendMock).toHaveBeenCalledTimes(1)
    const payload = sendMock.mock.calls[0][0]
    expect(payload.to).toBe('user@example.com')
    expect(payload.text).toContain('30 minutes')
    expect(payload.html).toContain('30 minutes')
  })

  it('tells the recipient their password is unchanged if they did not ask', async () => {
    const { sendPasswordResetEmail } = await import('../password-reset-email')

    await sendPasswordResetEmail(USER)

    expect(sendMock.mock.calls[0][0].text).toContain('your password has not changed')
  })

  it('throws when Resend reports an error in the body rather than throwing', async () => {
    const { sendPasswordResetEmail } = await import('../password-reset-email')
    sendMock.mockResolvedValue({ error: { message: 'domain not verified' } })

    await expect(sendPasswordResetEmail(USER)).rejects.toThrow(/domain not verified/)
  })
})
