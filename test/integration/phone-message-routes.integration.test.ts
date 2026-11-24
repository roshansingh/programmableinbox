import { describe, expect, it } from 'vitest'
import { GET, PATCH } from '@/app/api/app/phoneInbox/[id]/messages/route'
import { prisma } from '@/lib/db'
import { createOrgWithUser, createSecondOrg } from './helpers/auth'
import { jsonRequest, params } from './helpers/request'

let seq = 0
async function seedInbox(
  orgId: string,
  userId: string,
  status: 'pending' | 'active' | 'released' = 'active',
) {
  seq += 1
  return prisma.phoneInbox.create({
    data: {
      organizationId: orgId,
      userId,
      phoneNumber: `+1415556${String(seq).padStart(4, '0')}`,
      countryCode: 'US',
      status,
    },
  })
}

type Inbox = Awaited<ReturnType<typeof seedInbox>>

async function msg(
  inbox: Inbox,
  from: string,
  at: string,
  over: { body?: string; isRead?: boolean; deletedAt?: Date | null; mediaCount?: number } = {},
) {
  seq += 1
  return prisma.phoneMessage.create({
    data: {
      phoneInboxId: inbox.id,
      organizationId: inbox.organizationId,
      from,
      to: inbox.phoneNumber,
      body: over.body ?? `message ${seq}`,
      mediaCount: over.mediaCount ?? 0,
      externalId: `SM${String(seq).padStart(32, '0')}`,
      threadId: `${inbox.id}:${from}`,
      isRead: over.isRead ?? false,
      deletedAt: over.deletedAt ?? null,
      createdAt: new Date(at),
    },
  })
}

function list(inboxId: string, token: string, query = '') {
  return GET(
    jsonRequest(`http://localhost/api/app/phoneInbox/${inboxId}/messages${query}`, { credential: token }),
    params({ id: inboxId }),
  )
}

function markRead(inboxId: string, token: string, body: unknown) {
  return PATCH(
    jsonRequest(`http://localhost/api/app/phoneInbox/${inboxId}/messages`, {
      method: 'PATCH',
      credential: token,
      body,
    }),
    params({ id: inboxId }),
  )
}

describe('GET /api/app/phoneInbox/[id]/messages (threads)', () => {
  it('lists one head per counterparty, newest thread first, with counts', async () => {
    const a = await createOrgWithUser()
    const inbox = await seedInbox(a.org.id, a.user.id)
    await msg(inbox, '32665', '2026-11-01T10:00:00Z', { body: 'old code', isRead: true })
    await msg(inbox, '32665', '2026-11-01T12:00:00Z', { body: 'new code' })
    await msg(inbox, '+14155550199', '2026-11-01T11:00:00Z', { body: 'hello' })

    const res = await list(inbox.id, a.token)
    const { data } = await res.json()

    expect(res.status).toBe(200)
    expect(data.threads.map((t: { body: string }) => t.body)).toEqual(['new code', 'hello'])
    expect(data.threads[0]).toMatchObject({
      from: '32665',
      threadId: `${inbox.id}:32665`,
      threadCount: 2,
      unreadCount: 1,
    })
    expect(data.threads[1]).toMatchObject({ threadCount: 1, unreadCount: 1 })
    expect(data.hasMore).toBe(false)
    expect(data.nextCursor).toBeNull()
  })

  it('never lists, counts or returns a soft-deleted message', async () => {
    const a = await createOrgWithUser()
    const inbox = await seedInbox(a.org.id, a.user.id)
    await msg(inbox, '32665', '2026-11-01T10:00:00Z', { body: 'kept' })
    await msg(inbox, '32665', '2026-11-01T12:00:00Z', { body: 'gone', deletedAt: new Date() })
    await msg(inbox, '11111', '2026-11-01T13:00:00Z', { body: 'only deleted', deletedAt: new Date() })

    const { data } = await (await list(inbox.id, a.token)).json()

    expect(data.threads).toHaveLength(1)
    expect(data.threads[0]).toMatchObject({ body: 'kept', threadCount: 1, unreadCount: 1 })
  })

  it('pages across threads with identical timestamps without skipping or repeating', async () => {
    const a = await createOrgWithUser()
    const inbox = await seedInbox(a.org.id, a.user.id)
    for (const from of ['10001', '10002', '10003', '10004', '10005']) {
      await msg(inbox, from, '2026-11-01T10:00:00Z')
    }

    const seen: string[] = []
    let cursor: string | null = null
    for (let i = 0; i < 5; i++) {
      const q: string = `?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
      const { data } = await (await list(inbox.id, a.token, q)).json()
      seen.push(...data.threads.map((t: { from: string }) => t.from))
      if (!data.hasMore) break
      cursor = data.nextCursor
    }

    expect([...seen].sort()).toEqual(['10001', '10002', '10003', '10004', '10005'])
    expect(new Set(seen).size).toBe(5)
  })

  it('does not expose organization or provider identifiers', async () => {
    const a = await createOrgWithUser()
    const inbox = await seedInbox(a.org.id, a.user.id)
    await msg(inbox, '32665', '2026-11-01T10:00:00Z')

    const { data } = await (await list(inbox.id, a.token)).json()

    expect(Object.keys(data.threads[0]).sort()).toEqual(
      [
        'body', 'createdAt', 'extractedOtp', 'from', 'id', 'isRead', 'mediaCount',
        'phoneInboxId', 'threadCount', 'threadId', 'to', 'unreadCount',
      ].sort(),
    )
  })

  it('is 404 for another organization, an unknown id and a released number', async () => {
    const a = await createOrgWithUser()
    const b = await createSecondOrg()
    const inbox = await seedInbox(a.org.id, a.user.id)
    const released = await seedInbox(a.org.id, a.user.id, 'released')
    await msg(inbox, '32665', '2026-11-01T10:00:00Z')

    expect((await list(inbox.id, b.token)).status).toBe(404)
    expect((await list('00000000-0000-7000-8000-000000000000', a.token)).status).toBe(404)
    expect((await list(released.id, a.token)).status).toBe(404)
  })

  it('is 400 for a malformed cursor', async () => {
    const a = await createOrgWithUser()
    const inbox = await seedInbox(a.org.id, a.user.id)

    expect((await list(inbox.id, a.token, '?cursor=not-a-cursor')).status).toBe(400)
  })
})

describe('GET /api/app/phoneInbox/[id]/messages?threadId=', () => {
  it("returns one thread's messages, newest first", async () => {
    const a = await createOrgWithUser()
    const inbox = await seedInbox(a.org.id, a.user.id)
    await msg(inbox, '32665', '2026-11-01T12:00:00Z', { body: 'second' })
    await msg(inbox, '32665', '2026-11-01T10:00:00Z', { body: 'first' })
    await msg(inbox, '99999', '2026-11-01T11:00:00Z', { body: 'someone else' })
    await msg(inbox, '32665', '2026-11-01T13:00:00Z', { body: 'deleted', deletedAt: new Date() })

    const { data } = await (
      await list(inbox.id, a.token, `?threadId=${encodeURIComponent(`${inbox.id}:32665`)}`)
    ).json()

    expect(data.messages.map((m: { body: string }) => m.body)).toEqual(['second', 'first'])
    expect(data.threads).toBeUndefined()
  })

  it('pages a long thread backwards from the newest without gaps', async () => {
    const a = await createOrgWithUser()
    const inbox = await seedInbox(a.org.id, a.user.id)
    for (let i = 0; i < 5; i++) await msg(inbox, '32665', `2026-11-01T10:0${i}:00Z`, { body: `m${i}` })
    const threadId = encodeURIComponent(`${inbox.id}:32665`)

    const first = (await (await list(inbox.id, a.token, `?threadId=${threadId}&limit=3`)).json()).data
    const second = (
      await (
        await list(inbox.id, a.token, `?threadId=${threadId}&limit=3&cursor=${encodeURIComponent(first.nextCursor)}`)
      ).json()
    ).data

    expect([...first.messages, ...second.messages].map((m: { body: string }) => m.body)).toEqual([
      'm4', 'm3', 'm2', 'm1', 'm0',
    ])
    expect(second.hasMore).toBe(false)
  })

  it("does not return another inbox's thread", async () => {
    const a = await createOrgWithUser()
    const mine = await seedInbox(a.org.id, a.user.id)
    const other = await seedInbox(a.org.id, a.user.id)
    await msg(other, '32665', '2026-11-01T10:00:00Z')

    const { data } = await (
      await list(mine.id, a.token, `?threadId=${encodeURIComponent(`${other.id}:32665`)}`)
    ).json()

    expect(data.messages).toEqual([])
  })
})

describe('PATCH /api/app/phoneInbox/[id]/messages (mark a thread read)', () => {
  it("marks only that thread's live messages read", async () => {
    const a = await createOrgWithUser()
    const inbox = await seedInbox(a.org.id, a.user.id)
    const other = await seedInbox(a.org.id, a.user.id)
    const m1 = await msg(inbox, '32665', '2026-11-01T10:00:00Z')
    const m2 = await msg(inbox, '32665', '2026-11-01T11:00:00Z')
    const elsewhere = await msg(inbox, '99999', '2026-11-01T11:00:00Z')
    const otherInbox = await msg(other, '32665', '2026-11-01T11:00:00Z')
    const deleted = await msg(inbox, '32665', '2026-11-01T12:00:00Z', { deletedAt: new Date() })

    const res = await markRead(inbox.id, a.token, { threadId: `${inbox.id}:32665`, isRead: true })

    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ updated: 2 })
    const state = async (id: string) =>
      (await prisma.phoneMessage.findUniqueOrThrow({ where: { id } })).isRead
    expect(await state(m1.id)).toBe(true)
    expect(await state(m2.id)).toBe(true)
    expect(await state(elsewhere.id)).toBe(false)
    expect(await state(otherInbox.id)).toBe(false)
    expect(await state(deleted.id)).toBe(false)
  })

  it('can mark a thread unread again', async () => {
    const a = await createOrgWithUser()
    const inbox = await seedInbox(a.org.id, a.user.id)
    const m = await msg(inbox, '32665', '2026-11-01T10:00:00Z', { isRead: true })

    await markRead(inbox.id, a.token, { threadId: `${inbox.id}:32665`, isRead: false })

    expect((await prisma.phoneMessage.findUniqueOrThrow({ where: { id: m.id } })).isRead).toBe(false)
  })

  it('lets a teammate in the organization mark it read', async () => {
    const a = await createOrgWithUser()
    const mate = await createOrgWithUser()
    await prisma.membership.create({
      data: { userId: mate.user.id, organizationId: a.org.id, role: 'member' as never },
    })
    const inbox = await seedInbox(a.org.id, a.user.id)
    await msg(inbox, '32665', '2026-11-01T10:00:00Z')

    const res = await markRead(inbox.id, mate.token, { threadId: `${inbox.id}:32665`, isRead: true })

    expect(res.status).toBe(200)
  })

  it('is 404 for another organization and changes nothing', async () => {
    const a = await createOrgWithUser()
    const b = await createSecondOrg()
    const inbox = await seedInbox(a.org.id, a.user.id)
    const m = await msg(inbox, '32665', '2026-11-01T10:00:00Z')

    const res = await markRead(inbox.id, b.token, { threadId: `${inbox.id}:32665`, isRead: true })

    expect(res.status).toBe(404)
    expect((await prisma.phoneMessage.findUniqueOrThrow({ where: { id: m.id } })).isRead).toBe(false)
  })

  it('is 400 for a missing threadId or a non-boolean isRead', async () => {
    const a = await createOrgWithUser()
    const inbox = await seedInbox(a.org.id, a.user.id)

    expect((await markRead(inbox.id, a.token, { isRead: true })).status).toBe(400)
    expect((await markRead(inbox.id, a.token, { threadId: 'x', isRead: 'yes' })).status).toBe(400)
    expect((await markRead(inbox.id, a.token, { threadId: '', isRead: true })).status).toBe(400)
  })

  it('is 401 without a session', async () => {
    const a = await createOrgWithUser()
    const inbox = await seedInbox(a.org.id, a.user.id)

    const res = await PATCH(
      jsonRequest(`http://localhost/api/app/phoneInbox/${inbox.id}/messages`, {
        method: 'PATCH',
        body: { threadId: 'x', isRead: true },
      }),
      params({ id: inbox.id }),
    )

    expect(res.status).toBe(401)
  })
})

describe('malformed input is rejected, not thrown', () => {
  const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url')

  it('answers 404 for an inbox id that is not a UUID', async () => {
    const a = await createOrgWithUser()

    expect((await list('abc', a.token)).status).toBe(404)
    expect((await markRead('abc', a.token, { threadId: 'x', isRead: true })).status).toBe(404)
  })

  it('answers 400 for a cursor whose id is not a UUID, on both read paths', async () => {
    const a = await createOrgWithUser()
    const inbox = await seedInbox(a.org.id, a.user.id)
    const cursor = encodeURIComponent(b64('1700000000000|not-a-uuid'))

    expect((await list(inbox.id, a.token, `?cursor=${cursor}`)).status).toBe(400)
    expect((await list(inbox.id, a.token, `?threadId=x&cursor=${cursor}`)).status).toBe(400)
  })

  it('answers 400 for a cursor instant Postgres cannot store, on both read paths', async () => {
    const a = await createOrgWithUser()
    const inbox = await seedInbox(a.org.id, a.user.id)
    const cursor = encodeURIComponent(b64('-8000000000000000|00000000-0000-7000-8000-000000000000'))

    expect((await list(inbox.id, a.token, `?cursor=${cursor}`)).status).toBe(400)
    expect((await list(inbox.id, a.token, `?threadId=x&cursor=${cursor}`)).status).toBe(400)
  })

  it('answers 400 for a threadId containing a NUL byte or an empty threadId', async () => {
    const a = await createOrgWithUser()
    const inbox = await seedInbox(a.org.id, a.user.id)

    expect((await list(inbox.id, a.token, '?threadId=a%00b')).status).toBe(400)
    expect((await list(inbox.id, a.token, '?threadId=')).status).toBe(400)
    expect((await markRead(inbox.id, a.token, { threadId: 'a\u0000b', isRead: true })).status).toBe(400)
  })
})
