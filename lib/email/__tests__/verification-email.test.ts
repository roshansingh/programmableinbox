import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withConfigEnv } from '@/test/config'

const sendMock = vi.fn()

vi.mock('@/lib/resend', () => ({
  getResend: () => ({ emails: { send: (...args: unknown[]) => sendMock(...args) } }),
}))

const ENABLED = {
  ENABLE_EMAIL_VERIFICATION: 'true',
  EMAIL_LINK_SECRET: 'verification-secret-at-least-16',
  APP_BASE_URL: 'https://app.example.com',
}

describe('sendVerificationEmail', () => {
  withConfigEnv(ENABLED)

  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    sendMock.mockResolvedValue({ data: { id: 'resend_1' }, error: null })
  })

  it('sends to the user, from the configured sender', async () => {
    const { sendVerificationEmail } = await import('../verification-email')

    await sendVerificationEmail({ id: 'u1', email: 'person@example.com' })

    const payload = sendMock.mock.calls[0][0]
    expect(payload.to).toBe('person@example.com')
    expect(payload.from).toBe('Test <test@example.com>')
    expect(payload.subject).toContain('Verify your email address')
  })

  it('carries the same absolute link in both the HTML and the plain-text body', async () => {
    const { sendVerificationEmail } = await import('../verification-email')

    await sendVerificationEmail({ id: 'u1', email: 'person@example.com' })

    const { html, text } = sendMock.mock.calls[0][0]
    const link = /https:\/\/app\.example\.com\/auth\/verify\?token=[^\s"<]+/
    expect(text).toMatch(link)
    expect(html).toMatch(link)
    expect(text.match(link)![0]).toBe(html.match(link)![0])
  })

  /**
   * The origin is `APP_BASE_URL`, never a request header — see the schema in
   * lib/config/schema.ts. A link built from an attacker-controlled `Host` is a
   * phishing primitive signed by our own sending domain.
   */
  it('builds the link from APP_BASE_URL', async () => {
    const { buildVerificationUrl } = await import('../verification-email')

    expect(buildVerificationUrl('tok')).toBe('https://app.example.com/auth/verify?token=tok')
  })

  /** No redirect parameter of any kind — that would be an open redirect. */
  it('puts nothing but the token in the query string', async () => {
    const { sendVerificationEmail } = await import('../verification-email')

    await sendVerificationEmail({ id: 'u1', email: 'person@example.com' })

    const url = new URL(sendMock.mock.calls[0][0].text.match(/https:\/\/\S+/)![0])
    expect([...url.searchParams.keys()]).toEqual(['token'])
  })

  it('states the expiry window, so an old link is self-explanatory', async () => {
    const { sendVerificationEmail } = await import('../verification-email')

    await sendVerificationEmail({ id: 'u1', email: 'person@example.com' })

    const { html, text } = sendMock.mock.calls[0][0]
    expect(text).toContain('24 hours')
    expect(html).toContain('24 hours')
  })

  /**
   * The Resend SDK reports failures in the response body rather than by
   * throwing. A caller that only catches would treat a rejected send as a
   * success — and, on the resend path, stamp a cooldown for mail that never
   * went out.
   */
  it('throws when Resend reports an error in the response body', async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: 'domain not verified' } })
    const { sendVerificationEmail } = await import('../verification-email')

    await expect(
      sendVerificationEmail({ id: 'u1', email: 'person@example.com' }),
    ).rejects.toThrow(/domain not verified/)
  })

  it('escapes the address in the HTML body', async () => {
    const { sendVerificationEmail } = await import('../verification-email')

    await sendVerificationEmail({ id: 'u1', email: 'a"><script>x</script>@example.com' })

    expect(sendMock.mock.calls[0][0].html).not.toContain('<script>')
  })
})

describe('sendVerificationEmail when the feature is not configured', () => {
  withConfigEnv({
    ENABLE_EMAIL_VERIFICATION: undefined,
    EMAIL_LINK_SECRET: undefined,
    APP_BASE_URL: undefined,
  })

  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
  })

  it('throws naming the missing variables rather than mailing a broken link', async () => {
    const { sendVerificationEmail } = await import('../verification-email')

    await expect(
      sendVerificationEmail({ id: 'u1', email: 'person@example.com' }),
    ).rejects.toThrow(/EMAIL_LINK_SECRET/)
    expect(sendMock).not.toHaveBeenCalled()
  })
})
