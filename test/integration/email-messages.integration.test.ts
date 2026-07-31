import { describe, it, expect } from 'vitest'
import { GET as listMessages } from '@/app/api/app/emailInbox/[id]/messages/route'
import {
  GET as getMessage,
  PATCH as patchMessage,
  DELETE as deleteMessage,
} from '@/app/api/app/emailInbox/[id]/messages/[messageId]/route'
import { GET as getOtp } from '@/app/api/app/emailInbox/[id]/otp/route'
import { prisma } from '@/lib/db'
import { createOrgWithUser, createSecondOrg } from './helpers/auth'
import { seedInbox, seedMessage } from './helpers/factories'
import { jsonRequest, params } from './helpers/request'

// Deterministic, strictly-increasing timestamps for ordering-sensitive seeds.
// Explicit createdAt beats setTimeout sleeps: no flakiness from same-millisecond
// inserts, and no wall-clock delay in the suite.
const BASE_MS = Date.parse('2026-01-01T00:00:00.000Z')
const at = (n: number) => new Date(BASE_MS + n * 1000)

describe('GET /api/app/emailInbox/[id]/messages', () => {
  it('401 without a token', async () => {
    const res = await listMessages(
      jsonRequest('http://localhost/api/app/emailInbox/some-id/messages'),
      params({ id: 'some-id' }),
    )
    expect(res.status).toBe(401)
  })

  it('lists messages for an inbox, newest first', async () => {
    const { org, user, token } = await createOrgWithUser()
    const inbox = await seedInbox(org.id, user.id)
    const m1 = await seedMessage(inbox.id, org.id, { subject: 'first', createdAt: at(1) })
    const m2 = await seedMessage(inbox.id, org.id, { subject: 'second', createdAt: at(2) })
    const m3 = await seedMessage(inbox.id, org.id, { subject: 'third', createdAt: at(3) })

    const res = await listMessages(
      jsonRequest(`http://localhost/api/app/emailInbox/${inbox.id}/messages`, { credential: token }),
      params({ id: inbox.id }),
    )
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.messages).toHaveLength(3)
    expect(data.messages.map((m: { id: string }) => m.id)).toEqual([m3.id, m2.id, m1.id])
    expect(data.hasMore).toBe(false)
    expect(data.nextCursor).toBeNull()
  })

  it('cursor-paginates through the flat list with no overlap and correct remainder', async () => {
    const { org, user, token } = await createOrgWithUser()
    const inbox = await seedInbox(org.id, user.id)
    const m1 = await seedMessage(inbox.id, org.id, { subject: 'first', createdAt: at(1) })
    const m2 = await seedMessage(inbox.id, org.id, { subject: 'second', createdAt: at(2) })
    const m3 = await seedMessage(inbox.id, org.id, { subject: 'third', createdAt: at(3) })

    const page1 = await listMessages(
      jsonRequest(`http://localhost/api/app/emailInbox/${inbox.id}/messages?limit=2`, { credential: token }),
      params({ id: inbox.id }),
    )
    expect(page1.status).toBe(200)
    const body1 = (await page1.json()).data
    expect(body1.messages.map((m: { id: string }) => m.id)).toEqual([m3.id, m2.id])
    expect(body1.hasMore).toBe(true)
    expect(body1.nextCursor).not.toBeNull()

    const page2 = await listMessages(
      jsonRequest(
        `http://localhost/api/app/emailInbox/${inbox.id}/messages?limit=2&cursor=${encodeURIComponent(body1.nextCursor)}`,
        { credential: token },
      ),
      params({ id: inbox.id }),
    )
    expect(page2.status).toBe(200)
    const body2 = (await page2.json()).data
    expect(body2.messages.map((m: { id: string }) => m.id)).toEqual([m1.id])
    expect(body2.hasMore).toBe(false)
    expect(body2.nextCursor).toBeNull()

    // No overlap between pages.
    const page1Ids = new Set(body1.messages.map((m: { id: string }) => m.id))
    const page2Ids = body2.messages.map((m: { id: string }) => m.id)
    for (const id of page2Ids) expect(page1Ids.has(id)).toBe(false)
  })

  it('grouped mode returns one thread head per thread with correct threadCount, cursor-paginated', async () => {
    const { org, user, token } = await createOrgWithUser()
    const inbox = await seedInbox(org.id, user.id)

    const threadA = '00000000-0000-7000-8000-0000000000aa'
    const threadB = '00000000-0000-7000-8000-0000000000bb'

    // Thread A: 2 messages (older then newer).
    await seedMessage(inbox.id, org.id, { threadId: threadA, subject: 'A1', createdAt: at(1) })
    const a2 = await seedMessage(inbox.id, org.id, { threadId: threadA, subject: 'A2', createdAt: at(2) })
    // Thread B: 1 message, created after thread A's messages (so it's the latest thread).
    const b1 = await seedMessage(inbox.id, org.id, { threadId: threadB, subject: 'B1', createdAt: at(3) })

    const res = await listMessages(
      jsonRequest(`http://localhost/api/app/emailInbox/${inbox.id}/messages?grouped=true`, { credential: token }),
      params({ id: inbox.id }),
    )
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.messages).toHaveLength(2)

    // Newest thread head first: thread B (b1), then thread A (a2, the latest message in that thread).
    expect(data.messages[0].id).toBe(b1.id)
    expect(data.messages[0].threadId).toBe(threadB)
    expect(data.messages[0].threadCount).toBe(1)

    expect(data.messages[1].id).toBe(a2.id)
    expect(data.messages[1].threadId).toBe(threadA)
    expect(data.messages[1].threadCount).toBe(2)

    expect(data.hasMore).toBe(false)

    // Cursor-paginate across the two thread heads with limit=1.
    const page1 = await listMessages(
      jsonRequest(`http://localhost/api/app/emailInbox/${inbox.id}/messages?grouped=true&limit=1`, { credential: token }),
      params({ id: inbox.id }),
    )
    const body1 = (await page1.json()).data
    expect(body1.messages).toHaveLength(1)
    expect(body1.messages[0].id).toBe(b1.id)
    expect(body1.hasMore).toBe(true)
    expect(body1.nextCursor).not.toBeNull()

    const page2 = await listMessages(
      jsonRequest(
        `http://localhost/api/app/emailInbox/${inbox.id}/messages?grouped=true&limit=1&cursor=${encodeURIComponent(body1.nextCursor)}`,
        { credential: token },
      ),
      params({ id: inbox.id }),
    )
    const body2 = (await page2.json()).data
    expect(body2.messages).toHaveLength(1)
    expect(body2.messages[0].id).toBe(a2.id)
    expect(body2.messages[0].threadCount).toBe(2)
    expect(body2.hasMore).toBe(false)
    expect(body2.nextCursor).toBeNull()
  })

  it('soft-deleted messages disappear from the flat list and from grouped threadCount', async () => {
    const { org, user, token } = await createOrgWithUser()
    const inbox = await seedInbox(org.id, user.id)
    const threadA = '00000000-0000-7000-8000-0000000000cc'
    const a1 = await seedMessage(inbox.id, org.id, { threadId: threadA, subject: 'A1', createdAt: at(1) })
    const a2 = await seedMessage(inbox.id, org.id, { threadId: threadA, subject: 'A2', createdAt: at(2) })

    await deleteMessage(
      jsonRequest(`http://localhost/api/app/emailInbox/${inbox.id}/messages/${a2.id}`, {
        method: 'DELETE', credential: token,
      }),
      params({ id: inbox.id, messageId: a2.id }),
    )

    const flatRes = await listMessages(
      jsonRequest(`http://localhost/api/app/emailInbox/${inbox.id}/messages`, { credential: token }),
      params({ id: inbox.id }),
    )
    const flatBody = (await flatRes.json()).data
    expect(flatBody.messages.map((m: { id: string }) => m.id)).toEqual([a1.id])

    const groupedRes = await listMessages(
      jsonRequest(`http://localhost/api/app/emailInbox/${inbox.id}/messages?grouped=true`, { credential: token }),
      params({ id: inbox.id }),
    )
    const groupedBody = (await groupedRes.json()).data
    expect(groupedBody.messages).toHaveLength(1)
    expect(groupedBody.messages[0].id).toBe(a1.id)
    expect(groupedBody.messages[0].threadCount).toBe(1)
  })
})

describe('GET /api/app/emailInbox/[id]/messages/[messageId]', () => {
  it('401 without a token', async () => {
    const res = await getMessage(
      jsonRequest('http://localhost/api/app/emailInbox/some-id/messages/some-message'),
      params({ id: 'some-id', messageId: 'some-message' }),
    )
    expect(res.status).toBe(401)
  })

  it('gets the caller\'s own message', async () => {
    const { org, user, token } = await createOrgWithUser()
    const inbox = await seedInbox(org.id, user.id)
    const message = await seedMessage(inbox.id, org.id, { subject: 'hello' })

    const res = await getMessage(
      jsonRequest(`http://localhost/api/app/emailInbox/${inbox.id}/messages/${message.id}`, { credential: token }),
      params({ id: inbox.id, messageId: message.id }),
    )
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.id).toBe(message.id)
    expect(data.subject).toBe('hello')
  })

  it('404 for a message that belongs to another org\'s inbox', async () => {
    const { org: orgA, user: userA } = await createOrgWithUser()
    const inboxA = await seedInbox(orgA.id, userA.id)
    const messageA = await seedMessage(inboxA.id, orgA.id)

    const { org: orgB, user: userB, token: tokenB } = await createSecondOrg()
    const inboxB = await seedInbox(orgB.id, userB.id)

    // Try to reach org A's message through org B's own inbox id.
    const res = await getMessage(
      jsonRequest(`http://localhost/api/app/emailInbox/${inboxB.id}/messages/${messageA.id}`, { credential: tokenB }),
      params({ id: inboxB.id, messageId: messageA.id }),
    )
    expect(res.status).toBe(404)
  })

  it('404 for a message reached via another org\'s inbox id directly', async () => {
    const { org: orgA, user: userA } = await createOrgWithUser()
    const inboxA = await seedInbox(orgA.id, userA.id)
    const messageA = await seedMessage(inboxA.id, orgA.id)

    const { token: tokenB } = await createSecondOrg()

    const res = await getMessage(
      jsonRequest(`http://localhost/api/app/emailInbox/${inboxA.id}/messages/${messageA.id}`, { credential: tokenB }),
      params({ id: inboxA.id, messageId: messageA.id }),
    )
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/app/emailInbox/[id]/messages/[messageId]', () => {
  it('401 without a token', async () => {
    const res = await patchMessage(
      jsonRequest('http://localhost/api/app/emailInbox/some-id/messages/some-message', { method: 'PATCH', body: {} }),
      params({ id: 'some-id', messageId: 'some-message' }),
    )
    expect(res.status).toBe(401)
  })

  it('updates isStarred and persists it', async () => {
    const { org, user, token } = await createOrgWithUser()
    const inbox = await seedInbox(org.id, user.id)
    const message = await seedMessage(inbox.id, org.id, { isStarred: false })

    const res = await patchMessage(
      jsonRequest(`http://localhost/api/app/emailInbox/${inbox.id}/messages/${message.id}`, {
        method: 'PATCH', credential: token,
        body: { isStarred: true },
      }),
      params({ id: inbox.id, messageId: message.id }),
    )
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.isStarred).toBe(true)

    const row = await prisma.emailMessage.findUniqueOrThrow({ where: { id: message.id } })
    expect(row.isStarred).toBe(true)
  })

  it('400 when isStarred is not a boolean', async () => {
    const { org, user, token } = await createOrgWithUser()
    const inbox = await seedInbox(org.id, user.id)
    const message = await seedMessage(inbox.id, org.id)

    const res = await patchMessage(
      jsonRequest(`http://localhost/api/app/emailInbox/${inbox.id}/messages/${message.id}`, {
        method: 'PATCH', credential: token,
        body: { isStarred: 'yes' },
      }),
      params({ id: inbox.id, messageId: message.id }),
    )
    expect(res.status).toBe(400)
  })

  it('404 patching a message under another org\'s inbox', async () => {
    const { org: orgA, user: userA } = await createOrgWithUser()
    const inboxA = await seedInbox(orgA.id, userA.id)
    const messageA = await seedMessage(inboxA.id, orgA.id, { isStarred: false })

    const { token: tokenB } = await createSecondOrg()

    const res = await patchMessage(
      jsonRequest(`http://localhost/api/app/emailInbox/${inboxA.id}/messages/${messageA.id}`, {
        method: 'PATCH', credential: tokenB,
        body: { isStarred: true },
      }),
      params({ id: inboxA.id, messageId: messageA.id }),
    )
    expect(res.status).toBe(404)

    const row = await prisma.emailMessage.findUniqueOrThrow({ where: { id: messageA.id } })
    expect(row.isStarred).toBe(false)
  })
})

describe('DELETE /api/app/emailInbox/[id]/messages/[messageId]', () => {
  it('401 without a token', async () => {
    const res = await deleteMessage(
      jsonRequest('http://localhost/api/app/emailInbox/some-id/messages/some-message', { method: 'DELETE' }),
      params({ id: 'some-id', messageId: 'some-message' }),
    )
    expect(res.status).toBe(401)
  })

  it('soft-deletes the message: sets deletedAt, hides it from GET and the list', async () => {
    const { org, user, token } = await createOrgWithUser()
    const inbox = await seedInbox(org.id, user.id)
    const message = await seedMessage(inbox.id, org.id)

    const res = await deleteMessage(
      jsonRequest(`http://localhost/api/app/emailInbox/${inbox.id}/messages/${message.id}`, {
        method: 'DELETE', credential: token,
      }),
      params({ id: inbox.id, messageId: message.id }),
    )
    // 204 rather than the pre-split 200 + { deleted: true }: this matches the
    // inbox DELETE, and lib/api/emails.api.ts declares deleteEmailMessage as
    // Promise<void> and never reads the body.
    expect(res.status).toBe(204)

    const row = await prisma.emailMessage.findFirst({ where: { id: message.id, deletedAt: { not: null } } })
    expect(row).not.toBeNull()
    expect(row!.deletedAt).not.toBeNull()

    const getRes = await getMessage(
      jsonRequest(`http://localhost/api/app/emailInbox/${inbox.id}/messages/${message.id}`, { credential: token }),
      params({ id: inbox.id, messageId: message.id }),
    )
    expect(getRes.status).toBe(404)

    const listRes = await listMessages(
      jsonRequest(`http://localhost/api/app/emailInbox/${inbox.id}/messages`, { credential: token }),
      params({ id: inbox.id }),
    )
    const listBody = (await listRes.json()).data
    expect(listBody.messages.find((m: { id: string }) => m.id === message.id)).toBeUndefined()
  })

  it('404 deleting a message under another org\'s inbox, and does not soft-delete it', async () => {
    const { org: orgA, user: userA } = await createOrgWithUser()
    const inboxA = await seedInbox(orgA.id, userA.id)
    const messageA = await seedMessage(inboxA.id, orgA.id)

    const { token: tokenB } = await createSecondOrg()

    const res = await deleteMessage(
      jsonRequest(`http://localhost/api/app/emailInbox/${inboxA.id}/messages/${messageA.id}`, {
        method: 'DELETE', credential: tokenB,
      }),
      params({ id: inboxA.id, messageId: messageA.id }),
    )
    expect(res.status).toBe(404)

    const row = await prisma.emailMessage.findUniqueOrThrow({ where: { id: messageA.id } })
    expect(row.deletedAt).toBeNull()
  })
})

describe('GET /api/app/emailInbox/[id]/otp', () => {
  it('401 without a token', async () => {
    const res = await getOtp(
      jsonRequest('http://localhost/api/app/emailInbox/some-id/otp'),
      params({ id: 'some-id' }),
    )
    expect(res.status).toBe(401)
  })

  it('returns the latest extractedOtp for the inbox', async () => {
    const { org, user, token } = await createOrgWithUser()
    const inbox = await seedInbox(org.id, user.id)
    await seedMessage(inbox.id, org.id, { extractedOtp: '111111', createdAt: at(1) })
    const latest = await seedMessage(inbox.id, org.id, { extractedOtp: '222222', createdAt: at(2) })

    const res = await getOtp(
      jsonRequest(`http://localhost/api/app/emailInbox/${inbox.id}/otp`, { credential: token }),
      params({ id: inbox.id }),
    )
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.otp).toBe('222222')
    expect(data.messageId).toBe(latest.id)
  })

  it('404 when no message has an extractedOtp', async () => {
    const { org, user, token } = await createOrgWithUser()
    const inbox = await seedInbox(org.id, user.id)
    await seedMessage(inbox.id, org.id, { extractedOtp: null })

    const res = await getOtp(
      jsonRequest(`http://localhost/api/app/emailInbox/${inbox.id}/otp`, { credential: token }),
      params({ id: inbox.id }),
    )
    expect(res.status).toBe(404)
    const { message } = await res.json()
    expect(message).toBe('No OTP found for this inbox')
  })

  it('404 for another org\'s inbox', async () => {
    const { org, user } = await createOrgWithUser()
    const inbox = await seedInbox(org.id, user.id)
    await seedMessage(inbox.id, org.id, { extractedOtp: '333333' })

    const { token: otherToken } = await createSecondOrg()

    const res = await getOtp(
      jsonRequest(`http://localhost/api/app/emailInbox/${inbox.id}/otp`, { credential: otherToken }),
      params({ id: inbox.id }),
    )
    expect(res.status).toBe(404)
  })
})
