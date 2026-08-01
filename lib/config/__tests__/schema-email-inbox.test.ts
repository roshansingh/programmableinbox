import { describe, it, expect, afterEach } from 'vitest'
import { parseDomain, resetConfigCache, ConfigError } from '@/lib/config'

/**
 * `EMAIL_INBOX_DOMAINS` is required and boot-asserted (issue #98): an inbox at
 * a domain we do not receive mail for is unroutable by construction, so a
 * server with no allowlist has no working address to hand out. These pin the
 * boot-time contract that replaced the old request-time 503.
 */
const ORIGINAL = process.env.EMAIL_INBOX_DOMAINS

function withValue(raw: string | undefined) {
  if (raw === undefined) delete process.env.EMAIL_INBOX_DOMAINS
  else process.env.EMAIL_INBOX_DOMAINS = raw
  resetConfigCache()
  return parseDomain('emailInbox')
}

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.EMAIL_INBOX_DOMAINS
  else process.env.EMAIL_INBOX_DOMAINS = ORIGINAL
  resetConfigCache()
})

describe('emailInbox config domain', () => {
  it('parses a single domain', () => {
    expect(withValue('inbox.pibx.dev').domains).toEqual(['inbox.pibx.dev'])
  })

  it('splits on commas and trims', () => {
    expect(withValue(' inbox.pibx.dev , mail.example.com ').domains).toEqual([
      'inbox.pibx.dev',
      'mail.example.com',
    ])
  })

  it('lowercases, so comparison happens in the stored address space', () => {
    expect(withValue('Inbox.PIBX.dev').domains).toEqual(['inbox.pibx.dev'])
  })

  it('de-dupes while preserving order, so the first entry stays the UI default', () => {
    expect(withValue('a.example.com,b.example.com,A.example.com').domains).toEqual([
      'a.example.com',
      'b.example.com',
    ])
  })

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['whitespace only', '   '],
    ['separators only', ' , , '],
  ])('refuses to boot when %s', (_label, raw) => {
    expect(() => withValue(raw)).toThrow(ConfigError)
  })

  it.each([
    ['undotted', 'localhost'],
    ['containing @', 'user@example.com'],
    ['embedded space', 'bad domain.com'],
    ['non-ASCII', 'exämple.com'],
    ['leading dot', '.example.com'],
    ['trailing dot', 'example.com.'],
  ])('refuses to boot on a malformed entry (%s)', (_label, bad) => {
    // Throwing rather than dropping-with-a-warning is the point: a dropped
    // entry silently narrows the allowlist and shows up much later as "why
    // can't anyone create an inbox at our second domain".
    expect(() => withValue(`good.example.com,${bad}`)).toThrow(/EMAIL_INBOX_DOMAINS/)
  })

  it('names the offending entry without inventing a fallback', () => {
    expect(() => withValue('good.example.com,localhost')).toThrow(/localhost/)
  })
})
