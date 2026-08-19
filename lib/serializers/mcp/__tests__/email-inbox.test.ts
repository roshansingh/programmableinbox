import { describe, expect, it } from 'vitest'
import {
  MAX_DETAIL_BODY_LENGTH,
  SNIPPET_LENGTH,
  serializeMcpInbox,
  serializeMcpMessageConcise,
  serializeMcpMessageDetailed,
  truncate,
} from '../email-inbox'

const INBOX = {
  id: 'inbox_1',
  organizationId: 'org_1',
  userId: 'user_1',
  email: 'hello@pibx.dev',
  name: 'Support',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
}

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg_1',
    threadId: 'thread_1',
    parentMessageId: null,
    subject: 'Your code',
    from: 'noreply@stripe.com',
    to: ['hello@pibx.dev'],
    cc: [],
    bcc: [],
    text: 'plain part',
    html: '<html><style>.a{color:red}</style><body>hi</body></html>',
    bodyText: 'the parsed body text',
    isStarred: false,
    isRead: false,
    tags: ['invoice'],
    categories: ['billing'],
    extractedOtp: '123456',
    createdAt: new Date('2026-03-01T12:00:00.000Z'),
    ...overrides,
  }
}

describe('truncate', () => {
  it('leaves a value at or under the limit untouched', () => {
    expect(truncate('abcde', 5)).toBe('abcde')
    expect(truncate('abc', 5)).toBe('abc')
  })

  it('marks a truncated value with the number of dropped characters', () => {
    const result = truncate('abcdefghij', 4)
    expect(result.startsWith('abcd…')).toBe(true)
    expect(result).toContain('6 more characters')
  })

  it('includes the recovery hint only when one is given', () => {
    expect(truncate('abcdefghij', 4, 'call something')).toContain('— call something')
    expect(truncate('abcdefghij', 4)).not.toContain('—')
  })
})

describe('serializeMcpInbox', () => {
  it('publishes only the allowlisted fields', () => {
    expect(serializeMcpInbox(INBOX)).toEqual({
      id: 'inbox_1',
      email: 'hello@pibx.dev',
      name: 'Support',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('does not leak tenancy identifiers the model has no use for', () => {
    const result = serializeMcpInbox(INBOX) as Record<string, unknown>
    expect(result).not.toHaveProperty('organizationId')
    expect(result).not.toHaveProperty('userId')
  })
})

describe('serializeMcpMessageConcise', () => {
  it('never emits html, at any length', () => {
    const result = serializeMcpMessageConcise(message()) as Record<string, unknown>
    expect(result).not.toHaveProperty('html')
    expect(JSON.stringify(result)).not.toContain('<style>')
  })

  it('emits neither the raw text part nor a full body field', () => {
    const result = serializeMcpMessageConcise(message()) as Record<string, unknown>
    expect(result).not.toHaveProperty('text')
    expect(result).not.toHaveProperty('body')
    expect(result).not.toHaveProperty('bodyText')
  })

  it('includes the filterable fields so a follow-up query can be built', () => {
    const result = serializeMcpMessageConcise(message())
    expect(result.tags).toEqual(['invoice'])
    expect(result.categories).toEqual(['billing'])
  })

  it('surfaces extractedOtp without needing the message opened', () => {
    expect(serializeMcpMessageConcise(message()).extractedOtp).toBe('123456')
  })

  it('caps the snippet and flags that more body exists', () => {
    const body = 'x'.repeat(SNIPPET_LENGTH + 500)
    const result = serializeMcpMessageConcise(message({ bodyText: body }))

    expect(result.hasMoreBody).toBe(true)
    expect(result.snippet).toContain('500 more characters')
    expect(result.snippet).toContain('pibx_email_get_message')
    expect(result.snippet.length).toBeLessThan(body.length)
  })

  it('reports hasMoreBody false when the body fits', () => {
    const result = serializeMcpMessageConcise(message({ bodyText: 'short' }))
    expect(result.hasMoreBody).toBe(false)
    expect(result.snippet).toBe('short')
  })

  it('falls back to the text part when bodyText was never derived', () => {
    // Rows predating the issue #106 backfill: HTML-only mail has bodyText null.
    const result = serializeMcpMessageConcise(message({ bodyText: null, text: 'raw text' }))
    expect(result.snippet).toBe('raw text')
  })

  it('reports an empty body as an empty string, not null', () => {
    const result = serializeMcpMessageConcise(message({ bodyText: null, text: '' }))
    expect(result.snippet).toBe('')
    expect(result.hasMoreBody).toBe(false)
  })

  it('carries threadCount only for grouped rows', () => {
    expect(serializeMcpMessageConcise(message())).not.toHaveProperty('threadCount')
    expect(serializeMcpMessageConcise(message({ threadCount: 4 })).threadCount).toBe(4)
  })
})

describe('serializeMcpMessageDetailed', () => {
  it('returns the full body in place of the snippet', () => {
    const body = 'a'.repeat(SNIPPET_LENGTH + 100)
    const result = serializeMcpMessageDetailed(message({ bodyText: body })) as Record<
      string,
      unknown
    >

    expect(result.body).toBe(body)
    expect(result).not.toHaveProperty('snippet')
    expect(result).not.toHaveProperty('hasMoreBody')
  })

  it('still never emits html', () => {
    const result = serializeMcpMessageDetailed(message()) as Record<string, unknown>
    expect(result).not.toHaveProperty('html')
    expect(JSON.stringify(result)).not.toContain('<style>')
  })

  it('bounds even the detailed body, with no misleading recovery hint', () => {
    const body = 'b'.repeat(MAX_DETAIL_BODY_LENGTH + 42)
    const result = serializeMcpMessageDetailed(message({ bodyText: body }))

    expect(result.body).toContain('42 more characters')
    // There is no further call that would return more, so it must not claim one.
    expect(result.body).not.toContain('pibx_email_get_message')
  })
})
