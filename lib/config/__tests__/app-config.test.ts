import { describe, it, expect, afterEach, vi } from 'vitest'
import { getAppConfig } from '@/lib/config/app-config'
import { resetConfigCache } from '@/lib/config'

vi.mock('@/lib/logger', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const ORIGINAL = process.env.EMAIL_INBOX_DOMAINS

/** `config` memoizes per domain, so the memo must be dropped with the env. */
function configure(raw: string) {
  process.env.EMAIL_INBOX_DOMAINS = raw
  resetConfigCache()
}

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.EMAIL_INBOX_DOMAINS
  } else {
    process.env.EMAIL_INBOX_DOMAINS = ORIGINAL
  }
  resetConfigCache()
})

describe('getAppConfig', () => {
  it('exposes the configured inbox domains', () => {
    configure('inbox.pibx.dev,mail.example.com')
    expect(getAppConfig()).toEqual({
      emailInboxDomains: ['inbox.pibx.dev', 'mail.example.com'],
    })
  })

  /**
   * The list can never be empty here — EMAIL_INBOX_DOMAINS is required and
   * `assertConfig()` refuses to boot without it, so the browser is never handed
   * a config it cannot act on. The client still defaults to `[]` before
   * `/auth/me` resolves, which is the fail-closed direction.
   */
  it('propagates the config layer’s refusal rather than reporting an empty list', () => {
    delete process.env.EMAIL_INBOX_DOMAINS
    resetConfigCache()
    expect(() => getAppConfig()).toThrow(/EMAIL_INBOX_DOMAINS/)
  })

  it('reflects a restart that changed the configuration', () => {
    configure('first.example.com')
    expect(getAppConfig().emailInboxDomains).toEqual(['first.example.com'])

    // resetConfigCache stands in for the process restart that a real operator
    // change requires: the config layer memoizes per domain, deliberately, so
    // a mid-process env mutation cannot reintroduce an unvalidated value.
    configure('second.example.com')
    expect(getAppConfig().emailInboxDomains).toEqual(['second.example.com'])
  })

  /**
   * This object is served to every authenticated user. The allowlist type is
   * the review gate, and this test is the runtime one: a key added to AppConfig
   * without being added here fails the suite, which is the moment to ask
   * whether it is safe to publish.
   */
  it('contains exactly the allowlisted keys and no others', () => {
    configure('inbox.pibx.dev')
    expect(Object.keys(getAppConfig()).sort()).toEqual(['emailInboxDomains'])
  })

  it('leaks no secret from the environment', () => {
    configure('inbox.pibx.dev')
    const serialized = JSON.stringify(getAppConfig())

    for (const secret of [
      process.env.JWT_SECRET,
      process.env.WEBHOOK_SECRET,
      process.env.DATABASE_URL,
      process.env.AUTH_RESEND_API_KEY,
    ]) {
      if (secret) expect(serialized).not.toContain(secret)
    }
  })
})
