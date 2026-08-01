import { describe, it, expect, afterEach, vi } from 'vitest'
import { validateInboxAddress, validateInboxName } from '@/lib/validation/inbox-policy'
import { resetConfigCache } from '@/lib/config'

vi.mock('@/lib/logger', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const ORIGINAL = process.env.EMAIL_INBOX_DOMAINS

/**
 * `config` memoizes each domain per process, so mutating the environment is
 * only half the job — the cache has to be dropped too. `resetConfigCache()` is
 * the seam lib/config exposes for exactly this.
 */
function configure(domains: string) {
  process.env.EMAIL_INBOX_DOMAINS = domains
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

describe('validateInboxAddress', () => {
  it('accepts an ordinary address at a configured domain', () => {
    configure('inbox.example.com')
    expect(validateInboxAddress('qa-team@inbox.example.com')).toBeNull()
  })

  /**
   * There is no "unconfigured" request outcome any more: EMAIL_INBOX_DOMAINS is
   * required and `assertConfig()` refuses to boot without it, so an empty
   * allowlist cannot reach a handler. `lib/config/__tests__/schema.test.ts`
   * covers the boot-time rejection; what matters here is that the policy reads
   * the config layer rather than the environment directly.
   */
  it('fails loudly rather than allowing anything when the variable is unset', () => {
    delete process.env.EMAIL_INBOX_DOMAINS
    resetConfigCache()
    expect(() => validateInboxAddress('anything@example.com')).toThrow(
      /EMAIL_INBOX_DOMAINS/,
    )
  })

  describe('domain allowlist', () => {
    it('rejects an unconfigured domain with 400', () => {
      configure('inbox.example.com')
      const result = validateInboxAddress('qa@gmail.com')
      expect(result?.status).toBe(400)
    })

    it('names the allowed domains, which are already public config', () => {
      configure('inbox.example.com,mail.example.com')
      expect(validateInboxAddress('qa@gmail.com')?.message).toContain(
        'inbox.example.com, mail.example.com',
      )
    })

    it('rejects a subdomain of a configured domain', () => {
      configure('example.com')
      expect(validateInboxAddress('qa@evil.example.com')?.status).toBe(400)
    })

    it('accepts a configured domain regardless of submitted case', () => {
      configure('inbox.example.com')
      expect(validateInboxAddress('QA@Inbox.Example.COM')).toBeNull()
    })

    it('rejects an unsplittable address with 400', () => {
      configure('inbox.example.com')
      expect(validateInboxAddress('not-an-address')?.status).toBe(400)
    })
  })

  /**
   * The function must not depend on the caller having run `parseInboxAddress`
   * first. Its own docstring offers it to future creation paths, and a caller
   * that trusts that and skips the syntax check would otherwise admit
   * homoglyph addresses — `Аmazon@` (U+0410) normalizes to `mazon`, which no
   * term matches.
   */
  describe('enforces the address charset itself', () => {
    it.each([
      ['Cyrillic А (U+0410)', 'Аmazon@inbox.example.com'],
      ['Cyrillic а (U+0430)', 'аdmin@inbox.example.com'],
      ['Cyrillic р (U+0440)', 'supрort@inbox.example.com'],
      ['zero-width space', 'goo​gle@inbox.example.com'],
    ])('rejects %s with 400', (_label, address) => {
      configure('inbox.example.com')
      expect(validateInboxAddress(address)?.status).toBe(400)
    })

    it('rejects an over-long address', () => {
      configure('inbox.example.com')
      const address = `${'a'.repeat(250)}@inbox.example.com`
      expect(validateInboxAddress(address)?.status).toBe(400)
    })
  })

  describe('local-part blocklist', () => {
    it.each([
      'amazon-security',
      'g00gle',
      'g-o-o-g-l-e',
      'apple-id-support',
      'pi-support',
      'billing',
    ])('rejects %s with 422', (localPart) => {
      configure('inbox.example.com')
      expect(validateInboxAddress(`${localPart}@inbox.example.com`)?.status).toBe(422)
    })

    it('says retrying a variant will not help, without echoing the term list', () => {
      configure('inbox.example.com')
      const message = validateInboxAddress('amazon@inbox.example.com')?.message ?? ''
      expect(message).toMatch(/brand or system address/i)
      expect(message).not.toMatch(/amazon/i)
    })

    it('checks the domain before the local part, so a wrong domain is not masked', () => {
      configure('inbox.example.com')
      expect(validateInboxAddress('amazon@gmail.com')?.status).toBe(400)
    })
  })
})

describe('validateInboxName', () => {
  it('accepts an ordinary display name', () => {
    expect(validateInboxName('QA Team')).toBeNull()
  })

  it.each([undefined, null, ''])('treats %s as absent, not invalid', (value) => {
    expect(validateInboxName(value)).toBeNull()
  })

  it('rejects a non-string with 400', () => {
    expect(validateInboxName(42)?.status).toBe(400)
  })

  it('rejects a blocked brand with 422', () => {
    expect(validateInboxName('Amazon Support')?.status).toBe(422)
  })

  it('rejects a leetspeak brand with 422', () => {
    expect(validateInboxName('Paypa1 Billing')?.status).toBe(422)
  })

  it('rejects a Cyrillic homoglyph with 422 — the charset guard, not the term list', () => {
    // U+0410; strips to "mazon" under normalization, so only the charset check
    // catches it.
    const result = validateInboxName('Аmazon')
    expect(result?.status).toBe(422)
    expect(result?.message).toMatch(/letters, numbers/i)
  })

  it('rejects a zero-width space used to split a brand', () => {
    expect(validateInboxName('goo​gle')?.status).toBe(422)
  })

  it('trims before judging, so trailing space does not smuggle anything', () => {
    expect(validateInboxName('  Amazon  ')?.status).toBe(422)
  })

  it('treats a whitespace-only name as absent', () => {
    expect(validateInboxName('   ')).toBeNull()
  })

  /**
   * The address is length-capped by `lib/email-address.ts`; the name had no
   * equivalent, and the column is unbounded `text`. A megabyte of `a` validates
   * on every other axis and would then be served on every inbox listing.
   */
  describe('length', () => {
    it('accepts a name at the limit', () => {
      expect(validateInboxName('a'.repeat(200))).toBeNull()
    })

    it('rejects a name past the limit with 400', () => {
      expect(validateInboxName('a'.repeat(201))?.status).toBe(400)
    })

    it('rejects a megabyte of otherwise-valid text', () => {
      expect(validateInboxName('a'.repeat(1_000_000))?.status).toBe(400)
    })

    it('measures the trimmed value, so padding alone does not fail', () => {
      expect(validateInboxName(`  ${'a'.repeat(200)}  `)).toBeNull()
    })
  })
})
