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
})
