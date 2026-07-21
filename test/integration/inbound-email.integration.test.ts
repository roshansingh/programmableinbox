import { vi } from 'vitest'
import { resendClient } from './helpers/resend-stub'
const resend = vi.hoisted(() => ({ send: vi.fn(), verify: vi.fn(), receivingGet: vi.fn() }))
vi.mock('@/lib/resend', () => ({ getResend: () => resendClient(resend) }))

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { POST } from '@/app/api/v1/webhooks/email/route'
import type { ResendEmailData } from '@/app/api/v1/webhooks/email/route'
import { prisma } from '@/lib/db'
import { getLogger } from '@/lib/logger'
import { createOrgWithUser } from './helpers/auth'
import { seedInbox, seedMessage } from './helpers/factories'
import { jsonRequest } from './helpers/request'

function makeEmail(over: Partial<ResendEmailData> = {}): ResendEmailData {
  return {
    id: `resend-email-${Math.random().toString(36).slice(2)}`,
    from: 'sender@example.com',
    to: ['inbox@test.dev'],
    cc: [],
    bcc: [],
    subject: 'Hello there',
    text: 'body text',
    html: '<p>body text</p>',
    headers: {},
    created_at: new Date().toISOString(),
    ...over,
  }
}

function webhookRequest(body: unknown) {
  return jsonRequest('http://localhost/api/v1/webhooks/email', { method: 'POST', body })
}

describe('POST /api/v1/webhooks/email', () => {
  beforeEach(() => {
    resend.send.mockReset()
    resend.verify.mockReset()
    resend.receivingGet.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('401 on a bad signature', async () => {
    resend.verify.mockImplementation(() => {
      throw new Error('bad sig')
    })

    const res = await POST(webhookRequest({ type: 'email.received', data: { email_id: 'em_1' } }))
    expect(res.status).toBe(401)
    expect(resend.receivingGet).not.toHaveBeenCalled()
  })

  it('persists an EmailMessage scoped to the matching inbox on the happy path', async () => {
    const { org, user } = await createOrgWithUser()
    const inbox = await seedInbox(org.id, user.id, { email: 'inbox@test.dev' })
    resend.verify.mockReturnValue(undefined)
    const email = makeEmail({
      id: 'resend-happy-1',
      to: ['inbox@test.dev'],
      subject: 'Welcome',
      text: 'hi there',
      html: '<p>hi there</p>',
      headers: { 'message-id': '<happy-1@example.com>' },
    })
    resend.receivingGet.mockResolvedValue({ data: email })

    const res = await POST(webhookRequest({ type: 'email.received', data: { email_id: email.id } }))
    expect(res.status).toBe(200)

    const row = await prisma.emailMessage.findFirstOrThrow({ where: { externalId: email.id } })
    expect(row.inboxEmailAddressId).toBe(inbox.id)
    expect(row.organizationId).toBe(org.id)
    expect(row.from).toBe(email.from)
    expect(row.to).toEqual(email.to)
    expect(row.subject).toBe(email.subject)
    expect(row.text).toBe(email.text)
    expect(row.html).toBe(email.html)
    expect(row.headers).toEqual(email.headers)
    expect(row.messageId).toBe(`<happy-1@example.com>::${inbox.id}`)
    // New thread: threadId seeds to the message's own id.
    expect(row.threadId).toBe(row.id)
    expect(row.parentMessageId).toBeNull()
  })

  it('threads a reply by In-Reply-To header match, sharing the parent thread and setting parentMessageId', async () => {
    const { org, user } = await createOrgWithUser()
    const inbox = await seedInbox(org.id, user.id, { email: 'inbox@test.dev' })
    const parent = await seedMessage(inbox.id, org.id, {
      messageId: `<parent-1@example.com>::${inbox.id}`,
      subject: 'Original subject',
    })
    resend.verify.mockReturnValue(undefined)
    const reply = makeEmail({
      id: 'resend-reply-1',
      to: ['inbox@test.dev'],
      subject: 'Re: Original subject',
      headers: { 'in-reply-to': '<parent-1@example.com>' },
    })
    resend.receivingGet.mockResolvedValue({ data: reply })

    const res = await POST(webhookRequest({ type: 'email.received', data: { email_id: reply.id } }))
    expect(res.status).toBe(200)

    const row = await prisma.emailMessage.findFirstOrThrow({ where: { externalId: reply.id } })
    expect(row.threadId).toBe(parent.threadId)
    expect(row.parentMessageId).toBe(parent.id)
    expect(row.inReplyTo).toBe('<parent-1@example.com>')
  })

  it('threads a reply by normalized subject fallback when no header matches', async () => {
    const { org, user } = await createOrgWithUser()
    const inbox = await seedInbox(org.id, user.id, { email: 'inbox@test.dev' })
    const parent = await seedMessage(inbox.id, org.id, {
      subject: 'Quarterly update',
      messageId: '<unrelated-parent@example.com>::not-used',
    })
    resend.verify.mockReturnValue(undefined)
    const reply = makeEmail({
      id: 'resend-reply-subject-1',
      to: ['inbox@test.dev'],
      subject: 'Re: Quarterly update',
      headers: {}, // no in-reply-to / references — forces subject fallback
    })
    resend.receivingGet.mockResolvedValue({ data: reply })

    const res = await POST(webhookRequest({ type: 'email.received', data: { email_id: reply.id } }))
    expect(res.status).toBe(200)

    const row = await prisma.emailMessage.findFirstOrThrow({ where: { externalId: reply.id } })
    expect(row.threadId).toBe(parent.threadId)
    expect(row.parentMessageId).toBe(parent.id)
  })

  it('silently skips a duplicate (externalId, inboxEmailAddressId) delivery', async () => {
    const infoSpy = vi.spyOn(getLogger(), 'info')
    const errorSpy = vi.spyOn(getLogger(), 'error')

    const { org, user } = await createOrgWithUser()
    const inbox = await seedInbox(org.id, user.id, { email: 'inbox@test.dev' })
    resend.verify.mockReturnValue(undefined)
    const email = makeEmail({ id: 'resend-dupe-1', to: ['inbox@test.dev'] })
    resend.receivingGet.mockResolvedValue({ data: email })

    const body = { type: 'email.received', data: { email_id: email.id } }
    const res1 = await POST(webhookRequest(body))
    const res2 = await POST(webhookRequest(body))

    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
    const count = await prisma.emailMessage.count({ where: { externalId: email.id, inboxEmailAddressId: inbox.id } })
    expect(count).toBe(1)

    // The duplicate must be logged as a quiet skip (info), never as an error —
    // this is the behavior the P2002-detection refactor must preserve.
    expect(infoSpy).toHaveBeenCalledWith(
      { inboxEmail: inbox.email, externalId: email.id },
      'Duplicate email skipped for inbox'
    )
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('acknowledges a non-email.received event without persisting or fetching the email', async () => {
    const { org, user } = await createOrgWithUser()
    await seedInbox(org.id, user.id, { email: 'inbox@test.dev' })
    resend.verify.mockReturnValue(undefined)

    const res = await POST(webhookRequest({ type: 'email.opened', data: { email_id: 'em_opened' } }))
    expect(res.status).toBe(200)
    expect(resend.receivingGet).not.toHaveBeenCalled()
    const count = await prisma.emailMessage.count()
    expect(count).toBe(0)
  })
})
