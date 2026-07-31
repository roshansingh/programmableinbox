import { vi } from 'vitest'
import { resendClient } from './helpers/resend-stub'
const resend = vi.hoisted(() => ({ send: vi.fn(), verify: vi.fn(), receivingGet: vi.fn() }))
vi.mock('@/lib/resend', () => ({ getResend: () => resendClient(resend) }))

import { describe, it, expect, beforeEach } from 'vitest'
import { POST } from '@/app/api/app/emailInbox/[id]/send/route'
import { prisma } from '@/lib/db'
import { createOrgWithUser, createSecondOrg } from './helpers/auth'
import { seedInbox } from './helpers/factories'
import { jsonRequest, params } from './helpers/request'

describe('POST /api/app/emailInbox/[id]/send', () => {
  beforeEach(() => {
    resend.send.mockReset()
    resend.verify.mockReset()
    resend.receivingGet.mockReset()
  })

  it('401 without a token', async () => {
    const res = await POST(
      jsonRequest('http://localhost/api/app/emailInbox/some-id/send', { method: 'POST', body: {} }),
      params({ id: 'some-id' })
    )
    expect(res.status).toBe(401)
  })

  it('404 sending from another org\'s inbox', async () => {
    const { token } = await createOrgWithUser()
    const other = await createSecondOrg()
    const otherInbox = await seedInbox(other.org.id, other.user.id)

    const res = await POST(
      jsonRequest(`http://localhost/api/app/emailInbox/${otherInbox.id}/send`, {
        method: 'POST', credential: token,
        body: { to: ['dest@test.dev'], subject: 'Hi', text: 'body' },
      }),
      params({ id: otherInbox.id })
    )
    expect(res.status).toBe(404)
    expect(resend.send).not.toHaveBeenCalled()
  })

  it('400 when recipient (to) is missing', async () => {
    const { org, user, token } = await createOrgWithUser()
    const inbox = await seedInbox(org.id, user.id)

    const res = await POST(
      jsonRequest(`http://localhost/api/app/emailInbox/${inbox.id}/send`, {
        method: 'POST', credential: token,
        body: { subject: 'Hi', text: 'body' },
      }),
      params({ id: inbox.id })
    )
    expect(res.status).toBe(400)
    const { message } = await res.json()
    expect(message).toMatch(/recipient/i)
    expect(resend.send).not.toHaveBeenCalled()
  })

  it('400 when to is an empty array', async () => {
    const { org, user, token } = await createOrgWithUser()
    const inbox = await seedInbox(org.id, user.id)

    const res = await POST(
      jsonRequest(`http://localhost/api/app/emailInbox/${inbox.id}/send`, {
        method: 'POST', credential: token,
        body: { to: [], subject: 'Hi', text: 'body' },
      }),
      params({ id: inbox.id })
    )
    expect(res.status).toBe(400)
  })

  it('400 when subject is missing', async () => {
    const { org, user, token } = await createOrgWithUser()
    const inbox = await seedInbox(org.id, user.id)

    const res = await POST(
      jsonRequest(`http://localhost/api/app/emailInbox/${inbox.id}/send`, {
        method: 'POST', credential: token,
        body: { to: ['dest@test.dev'], text: 'body' },
      }),
      params({ id: inbox.id })
    )
    expect(res.status).toBe(400)
    const { message } = await res.json()
    expect(message).toMatch(/subject/i)
    expect(resend.send).not.toHaveBeenCalled()
  })

  it('400 when neither text nor html body is provided', async () => {
    const { org, user, token } = await createOrgWithUser()
    const inbox = await seedInbox(org.id, user.id)

    const res = await POST(
      jsonRequest(`http://localhost/api/app/emailInbox/${inbox.id}/send`, {
        method: 'POST', credential: token,
        body: { to: ['dest@test.dev'], subject: 'Hi' },
      }),
      params({ id: inbox.id })
    )
    expect(res.status).toBe(400)
    expect(resend.send).not.toHaveBeenCalled()
  })

  it('sends via Resend, persists the message, and seeds threadId to its own id for a new thread', async () => {
    const { org, user, token } = await createOrgWithUser()
    const inbox = await seedInbox(org.id, user.id)
    resend.send.mockResolvedValue({ data: { id: 'resend-sent-1' }, error: null })

    const res = await POST(
      jsonRequest(`http://localhost/api/app/emailInbox/${inbox.id}/send`, {
        method: 'POST', credential: token,
        body: { to: ['dest@test.dev'], subject: 'Hello there', text: 'body text' },
      }),
      params({ id: inbox.id })
    )

    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data.messageId).toBe('resend-sent-1')

    expect(resend.send).toHaveBeenCalledTimes(1)
    expect(resend.send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: inbox.email,
        to: ['dest@test.dev'],
        subject: 'Hello there',
        text: 'body text',
      })
    )

    const row = await prisma.emailMessage.findFirstOrThrow({ where: { externalId: 'resend-sent-1' } })
    expect(row.organizationId).toBe(org.id)
    expect(row.inboxEmailAddressId).toBe(inbox.id)
    expect(row.from).toBe(inbox.email)
    expect(row.to).toEqual(['dest@test.dev'])
    expect(row.subject).toBe('Hello there')
    expect(row.text).toBe('body text')
    expect(row.parentMessageId).toBeNull()
    // New thread: threadId seeds to the message's own id.
    expect(row.threadId).toBe(row.id)
  })

  it('joins an existing thread when inReplyTo matches a prior message', async () => {
    const { org, user, token } = await createOrgWithUser()
    const inbox = await seedInbox(org.id, user.id)

    const parent = await prisma.emailMessage.create({
      data: {
        from: 'someone@test.dev',
        to: [inbox.email],
        cc: [], bcc: [],
        subject: 'Original subject',
        text: 'original body', html: '', headers: {},
        externalId: 'ext-parent-1',
        inboxEmailAddressId: inbox.id,
        organizationId: org.id,
        threadId: '00000000-0000-7000-8000-000000000001',
        messageId: '<parent-1@test.dev>',
        references: [],
      },
    })

    resend.send.mockResolvedValue({ data: { id: 'resend-sent-reply-1' }, error: null })

    const res = await POST(
      jsonRequest(`http://localhost/api/app/emailInbox/${inbox.id}/send`, {
        method: 'POST', credential: token,
        body: {
          to: ['someone@test.dev'],
          subject: 'Re: Original subject',
          text: 'reply body',
          inReplyTo: '<parent-1@test.dev>',
        },
      }),
      params({ id: inbox.id })
    )

    expect(res.status).toBe(201)

    const row = await prisma.emailMessage.findFirstOrThrow({ where: { externalId: 'resend-sent-reply-1' } })
    expect(row.threadId).toBe(parent.threadId)
    expect(row.parentMessageId).toBe(parent.id)
  })

  it('500 when Resend returns an error, and does not persist a message', async () => {
    const { org, user, token } = await createOrgWithUser()
    const inbox = await seedInbox(org.id, user.id)
    resend.send.mockResolvedValue({ data: null, error: { message: 'Resend rejected the request' } })

    const res = await POST(
      jsonRequest(`http://localhost/api/app/emailInbox/${inbox.id}/send`, {
        method: 'POST', credential: token,
        body: { to: ['dest@test.dev'], subject: 'Hello there', text: 'body text' },
      }),
      params({ id: inbox.id })
    )

    expect(res.status).toBe(500)
    const count = await prisma.emailMessage.count({ where: { inboxEmailAddressId: inbox.id } })
    expect(count).toBe(0)
  })
})
