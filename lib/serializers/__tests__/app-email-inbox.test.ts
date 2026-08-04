import { describe, expect, it } from 'vitest'
import { serializeAppInbox, serializeAppMessage } from '../app/email-inbox'

const INBOX_ROW = {
  id: 'inbox_1',
  organizationId: 'org_1',
  userId: 'user_1',
  email: 'support@example.com',
  name: 'Support',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
}

describe('serializeAppInbox', () => {
  it('marks the creating user as owner', () => {
    expect(serializeAppInbox(INBOX_ROW, 'user_1').isOwner).toBe(true)
  })

  it('marks a different organization member as not owner', () => {
    expect(serializeAppInbox(INBOX_ROW, 'user_2').isOwner).toBe(false)
  })

  it('does not expose the raw creator id', () => {
    expect(serializeAppInbox(INBOX_ROW, 'user_2')).not.toHaveProperty('userId')
  })
})

const MESSAGE_ROW = {
  id: 'msg_1',
  inboxEmailAddressId: 'inbox_1',
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
  categories: ['billing'],
  extractedOtp: null,
  createdAt: new Date('2026-01-03T00:00:00.000Z'),
  messageId: '<a@b>',
  references: ['<x@y>'],
}

describe('serializeAppMessage', () => {
  it('returns the RFC-822 threading fields the reply composer builds headers from', () => {
    // components/compose-email-dialog.tsx reads msg.references and
    // msg.messageId to populate inReplyTo/references on a reply. Dropping
    // either breaks threading in the recipient's mail client.
    const result = serializeAppMessage(MESSAGE_ROW)
    expect(result.messageId).toBe('<a@b>')
    expect(result.references).toEqual(['<x@y>'])
  })

  it('passes through threadCount for grouped rows', () => {
    // app/emails/[id]/page.tsx renders the "N messages" badge from this.
    expect(serializeAppMessage({ ...MESSAGE_ROW, threadCount: 3 }).threadCount).toBe(3)
  })

  it('omits threadCount entirely for a flat message row', () => {
    expect(serializeAppMessage(MESSAGE_ROW)).not.toHaveProperty('threadCount')
  })

  it('keeps categories, which the dashboard renders', () => {
    expect(serializeAppMessage(MESSAGE_ROW).categories).toEqual(['billing'])
  })
})
