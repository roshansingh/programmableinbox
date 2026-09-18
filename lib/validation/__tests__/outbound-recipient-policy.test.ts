import { describe, it, expect, afterEach } from 'vitest'
import { isSameServiceRecipient, findSameServiceRecipients } from '@/lib/validation/outbound-recipient-policy'
import { resetConfigCache } from '@/lib/config'

const ORIGINAL = process.env.EMAIL_INBOX_ALLOWED_DOMAINS

function configure(domains: string) {
  process.env.EMAIL_INBOX_ALLOWED_DOMAINS = domains
  resetConfigCache()
}

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.EMAIL_INBOX_ALLOWED_DOMAINS
  } else {
    process.env.EMAIL_INBOX_ALLOWED_DOMAINS = ORIGINAL
  }
  resetConfigCache()
})

describe('isSameServiceRecipient', () => {
  it('is true for an address on a configured domain', () => {
    configure('inbox.example.com')
    expect(isSameServiceRecipient('someone@inbox.example.com')).toBe(true)
  })

  it('is false for an address on an unconfigured domain', () => {
    configure('inbox.example.com')
    expect(isSameServiceRecipient('someone@gmail.com')).toBe(false)
  })

  it('matches regardless of submitted case', () => {
    configure('inbox.example.com')
    expect(isSameServiceRecipient('Someone@Inbox.Example.COM')).toBe(true)
  })

  it('is false for a subdomain of a configured domain', () => {
    configure('example.com')
    expect(isSameServiceRecipient('someone@evil.example.com')).toBe(false)
  })

  it('is false for an unparseable address', () => {
    configure('inbox.example.com')
    expect(isSameServiceRecipient('not-an-address')).toBe(false)
  })

  /**
   * `to`/`cc`/`bcc` on the manual send route come straight from
   * `request.json()`, untyped — a `null` or non-string array entry must not
   * reach `String.prototype.trim()` inside `normalizeInboxAddress` and throw.
   */
  it.each([null, undefined, 42, {}, []])('is false for non-string input (%p) rather than throwing', (value) => {
    configure('inbox.example.com')
    expect(() => isSameServiceRecipient(value)).not.toThrow()
    expect(isSameServiceRecipient(value)).toBe(false)
  })

  /**
   * `splitAddress` splits on the last `@` with no awareness of RFC 5322
   * mailbox syntax, so an unextracted display-name form like
   * `Support <abuse@inbox.example.com>` yields the domain
   * `inbox.example.com>` (trailing bracket) — which matches nothing on the
   * allowlist and silently bypasses the block. `context.input.from` on the
   * auto_reply path carries the raw From header, which routinely has this
   * shape.
   */
  it('is true for a same-service address in RFC 5322 mailbox form ("Name <addr>")', () => {
    configure('inbox.example.com')
    expect(isSameServiceRecipient('Abuse Team <abuse@inbox.example.com>')).toBe(true)
  })

  it('is false for an external address in RFC 5322 mailbox form', () => {
    configure('inbox.example.com')
    expect(isSameServiceRecipient('Someone <someone@gmail.com>')).toBe(false)
  })
})

describe('findSameServiceRecipients', () => {
  it('returns only the addresses that match a configured domain', () => {
    configure('inbox.example.com')
    expect(
      findSameServiceRecipients(['a@gmail.com', 'b@inbox.example.com', 'c@inbox.example.com']),
    ).toEqual(['b@inbox.example.com', 'c@inbox.example.com'])
  })

  it('returns an empty array when nothing matches', () => {
    configure('inbox.example.com')
    expect(findSameServiceRecipients(['a@gmail.com', 'b@yahoo.com'])).toEqual([])
  })

  it('tolerates non-string entries rather than throwing', () => {
    configure('inbox.example.com')
    const addresses = ['a@inbox.example.com', null, undefined, 42]
    expect(() => findSameServiceRecipients(addresses)).not.toThrow()
    expect(findSameServiceRecipients(addresses)).toEqual(['a@inbox.example.com'])
  })
})
