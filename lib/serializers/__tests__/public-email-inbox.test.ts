import { describe, expect, it } from 'vitest'
import { serializePublicInbox, serializePublicMessage } from '../public/email-inbox'

const INBOX_ROW = {
  id: 'inbox_1',
  organizationId: 'org_1',
  userId: 'user_1',
  email: 'support@example.com',
  name: 'Support',
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
}

const MESSAGE_ROW = {
  id: 'msg_1',
  organizationId: 'org_1',
  inboxEmailAddressId: 'inbox_1',
  externalId: 'resend_abc123',
  messageId: '<a@b>',
  inReplyTo: null,
  references: [],
  headers: { 'x-provider': 'resend' },
  threadId: 'thread_1',
  parentMessageId: null,
  subject: 'Hello',
  from: 'sender@example.com',
  to: ['support@example.com'],
  cc: [],
  bcc: [],
  text: 'body',
  html: '<p>body</p>',
  bodyText: 'body',
  isStarred: false,
  tags: [],
  categories: [],
  extractedOtp: '123456',
  metadata: null,
  dispatchedAt: null,
  enrichedAt: null,
  deletedAt: null,
  createdAt: new Date('2026-01-03T00:00:00.000Z'),
  updatedAt: new Date('2026-01-03T00:00:00.000Z'),
}

describe('serializePublicInbox', () => {
  it('matches the published contract', () => {
    expect(serializePublicInbox(INBOX_ROW)).toMatchInlineSnapshot(`
      {
        "createdAt": "2026-01-01T00:00:00.000Z",
        "email": "support@example.com",
        "id": "inbox_1",
        "name": "Support",
        "organizationId": "org_1",
        "updatedAt": "2026-01-02T00:00:00.000Z",
      }
    `)
  })

  it('never exposes the creating user', () => {
    expect(serializePublicInbox(INBOX_ROW)).not.toHaveProperty('userId')
  })

  it('never exposes soft-delete state', () => {
    expect(serializePublicInbox(INBOX_ROW)).not.toHaveProperty('deletedAt')
  })

  it('ignores columns added to the model later', () => {
    const withNewColumn = { ...INBOX_ROW, someFutureSecret: 'leaked' }
    expect(serializePublicInbox(withNewColumn)).not.toHaveProperty('someFutureSecret')
  })
})

describe('serializePublicMessage', () => {
  it('matches the published contract', () => {
    expect(serializePublicMessage(MESSAGE_ROW)).toMatchInlineSnapshot(`
      {
        "bcc": [],
        "bodyText": "body",
        "categories": [],
        "cc": [],
        "createdAt": "2026-01-03T00:00:00.000Z",
        "extractedOtp": "123456",
        "from": "sender@example.com",
        "html": "<p>body</p>",
        "id": "msg_1",
        "isStarred": false,
        "parentMessageId": null,
        "subject": "Hello",
        "tags": [],
        "text": "body",
        "threadId": "thread_1",
        "to": [
          "support@example.com",
        ],
      }
    `)
  })

  it('exposes the searchable body text', () => {
    // Published alongside the `q` filter (issue #106): a caller that searches
    // needs to see what matched, and it is derived from `text`/`html`, which the
    // same messages:read scope already returns in full.
    expect(serializePublicMessage(MESSAGE_ROW).bodyText).toBe('body')
  })

  it('returns null body text for a message that predates extraction', () => {
    expect(serializePublicMessage({ ...MESSAGE_ROW, bodyText: null }).bodyText).toBeNull()
  })

  it('exposes categories, which the categories filter matches on', () => {
    // Previously withheld as worker-internal state. Shipping a filter for a field
    // the caller cannot read back is a worse contract than either extreme.
    const row = { ...MESSAGE_ROW, categories: ['receipt', 'otp'] }
    expect(serializePublicMessage(row).categories).toEqual(['receipt', 'otp'])
  })

  it('never exposes the provider identifier', () => {
    expect(serializePublicMessage(MESSAGE_ROW)).not.toHaveProperty('externalId')
  })

  it('exposes the extracted OTP', () => {
    // Deliberate: the OTP is derived from `text`/`html`, which the same
    // messages:read scope already returns, so withholding it would protect
    // nothing while forcing every consumer to re-parse the body.
    expect(serializePublicMessage(MESSAGE_ROW).extractedOtp).toBe('123456')
  })

  it('returns null OTP for a message with no code', () => {
    expect(serializePublicMessage({ ...MESSAGE_ROW, extractedOtp: null }).extractedOtp).toBeNull()
  })

  it('never exposes raw provider headers', () => {
    expect(serializePublicMessage(MESSAGE_ROW)).not.toHaveProperty('headers')
  })

  it('ignores columns added to the model later', () => {
    const withNewColumn = { ...MESSAGE_ROW, someFutureSecret: 'leaked' }
    expect(serializePublicMessage(withNewColumn)).not.toHaveProperty('someFutureSecret')
  })

  it('passes threadCount through for grouped rows', () => {
    // Documented in the OpenAPI spec for this endpoint as "present only in
    // grouped mode", and the pre-split route returned the raw grouped rows.
    expect(serializePublicMessage({ ...MESSAGE_ROW, threadCount: 4 }).threadCount).toBe(4)
  })

  it('omits threadCount entirely for a flat message row', () => {
    expect(serializePublicMessage(MESSAGE_ROW)).not.toHaveProperty('threadCount')
  })
})
