import { describe, it, expect } from 'vitest'
import { POST } from '@/app/api/v1/emailInbox/route'
import { PATCH, DELETE } from '@/app/api/v1/emailInbox/[id]/route'
import { GET as listInboxes } from '@/app/api/v1/emailInbox/route'
import { GET as getInbox } from '@/app/api/v1/emailInbox/[id]/route'
import { prisma } from '@/lib/db'
import { createOrgWithUser, createSecondOrg, createApiKey } from './helpers/auth'
import { seedInbox, seedMessage } from './helpers/factories'
import { jsonRequest, params } from './helpers/request'

const BASE = 'http://localhost/api/v1/emailInbox'

const READ = ['email_inboxes:read', 'email_messages:read']
const CREATE = [...READ, 'email_inboxes:create']
const UPDATE = [...READ, 'email_inboxes:update']
const DELETE_SCOPE = [...READ, 'email_inboxes:delete']

describe('POST /api/v1/emailInbox', () => {
  it('creates an inbox owned by the key organization and its minter', async () => {
    const { org, user } = await createOrgWithUser()
    const key = await createApiKey(org.id, user.id, CREATE)

    const res = await POST(
      jsonRequest(BASE, {
        method: 'POST',
        credential: key.rawKey,
        body: { email: 'v1-created@test.dev', name: 'Provisioned' },
      }),
      params({}),
    )

    expect(res.status).toBe(201)
    const { data } = await res.json()

    const row = await prisma.emailInbox.findUniqueOrThrow({ where: { id: data.id } })
    expect(row.organizationId).toBe(org.id)
    // Attributed to the human who minted the key — EmailInbox.userId is NOT NULL
    // and a key is not a person.
    expect(row.userId).toBe(user.id)
    expect(row.email).toBe('v1-created@test.dev')
  })

  it('403s a key holding only update or delete', async () => {
    const { org, user } = await createOrgWithUser()
    for (const scopes of [UPDATE, DELETE_SCOPE]) {
      const key = await createApiKey(org.id, user.id, scopes)
      const res = await POST(
        jsonRequest(BASE, {
          method: 'POST',
          credential: key.rawKey,
          body: { email: `denied-${scopes.length}@test.dev` },
        }),
        params({}),
      )
      expect(res.status).toBe(403)
    }
  })
})

describe('PATCH /api/v1/emailInbox/[id]', () => {
  it('renames an inbox the key is responsible for', async () => {
    const { org, user } = await createOrgWithUser()
    const key = await createApiKey(org.id, user.id, UPDATE)
    const inbox = await seedInbox(org.id, user.id)

    const res = await PATCH(
      jsonRequest(`${BASE}/${inbox.id}`, {
        method: 'PATCH',
        credential: key.rawKey,
        body: { name: 'Renamed' },
      }),
      params({ id: inbox.id }),
    )

    expect(res.status).toBe(200)
    const row = await prisma.emailInbox.findUniqueOrThrow({ where: { id: inbox.id } })
    expect(row.name).toBe('Renamed')
    // The address is untouched by a rename, and can never be otherwise.
    expect(row.email).toBe(inbox.email)
  })

  it('409s an attempt to re-point the address', async () => {
    const { org, user } = await createOrgWithUser()
    const key = await createApiKey(org.id, user.id, UPDATE)
    const inbox = await seedInbox(org.id, user.id)

    const res = await PATCH(
      jsonRequest(`${BASE}/${inbox.id}`, {
        method: 'PATCH',
        credential: key.rawKey,
        body: { email: 'somewhere-else@test.dev' },
      }),
      params({ id: inbox.id }),
    )

    expect(res.status).toBe(409)
    const row = await prisma.emailInbox.findUniqueOrThrow({ where: { id: inbox.id } })
    expect(row.email).toBe(inbox.email)
  })
})

describe('DELETE /api/v1/emailInbox/[id]', () => {
  it('403s a key holding create and update but not delete', async () => {
    const { org, user } = await createOrgWithUser()
    const key = await createApiKey(org.id, user.id, [
      ...READ,
      'email_inboxes:create',
      'email_inboxes:update',
    ])
    const inbox = await seedInbox(org.id, user.id)

    const res = await DELETE(
      jsonRequest(`${BASE}/${inbox.id}`, { method: 'DELETE', credential: key.rawKey }),
      params({ id: inbox.id }),
    )

    expect(res.status).toBe(403)
    const row = await prisma.emailInbox.findUniqueOrThrow({ where: { id: inbox.id } })
    expect(row.deletedAt).toBeNull()
  })

  it('soft-deletes the inbox and its messages, keeping every row', async () => {
    // This is the whole basis for `email_inboxes:delete` being its own scope,
    // so it is asserted against the database rather than the response.
    const { org, user } = await createOrgWithUser()
    const key = await createApiKey(org.id, user.id, DELETE_SCOPE)
    const inbox = await seedInbox(org.id, user.id)
    const message = await seedMessage(inbox.id, org.id)

    const res = await DELETE(
      jsonRequest(`${BASE}/${inbox.id}`, { method: 'DELETE', credential: key.rawKey }),
      params({ id: inbox.id }),
    )

    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')

    // Read through raw SQL: every Prisma read is filtered by the soft-delete
    // extension, so `findUnique` here would report the rows as gone and prove
    // nothing about whether they still exist.
    const [inboxRow] = await prisma.$queryRawUnsafe<Array<{ deletedAt: Date | null }>>(
      'SELECT "deletedAt" FROM "email_inboxes" WHERE "id" = $1::uuid',
      inbox.id,
    )
    const [messageRow] = await prisma.$queryRawUnsafe<Array<{ deletedAt: Date | null }>>(
      'SELECT "deletedAt" FROM "email_messages" WHERE "id" = $1::uuid',
      message.id,
    )

    expect(inboxRow.deletedAt).toBeInstanceOf(Date)
    expect(messageRow.deletedAt).toBeInstanceOf(Date)
  })

  it('hides the inbox from every read path afterwards', async () => {
    const { org, user } = await createOrgWithUser()
    const key = await createApiKey(org.id, user.id, DELETE_SCOPE)
    const inbox = await seedInbox(org.id, user.id)

    await DELETE(
      jsonRequest(`${BASE}/${inbox.id}`, { method: 'DELETE', credential: key.rawKey }),
      params({ id: inbox.id }),
    )

    const list = await listInboxes(jsonRequest(BASE, { credential: key.rawKey }), params({}))
    const { data } = await list.json()
    expect(data.map((i: { id: string }) => i.id)).not.toContain(inbox.id)

    const single = await getInbox(
      jsonRequest(`${BASE}/${inbox.id}`, { credential: key.rawKey }),
      params({ id: inbox.id }),
    )
    expect(single.status).toBe(404)
  })

  it('retires the address permanently — nobody can claim it again', async () => {
    // The part of deletion that is NOT recoverable, and the reason the scope
    // description promises it. `EmailInbox.email` is a plain unique index, not
    // one partial on `deletedAt IS NULL`, because mail keeps arriving for a
    // deleted address and the next claimant would receive it.
    const { org, user } = await createOrgWithUser()
    const key = await createApiKey(org.id, user.id, [...CREATE, 'email_inboxes:delete'])
    const inbox = await seedInbox(org.id, user.id, { email: 'retired@test.dev' })

    await DELETE(
      jsonRequest(`${BASE}/${inbox.id}`, { method: 'DELETE', credential: key.rawKey }),
      params({ id: inbox.id }),
    )

    // Not even by the organization that just released it.
    const reclaim = await POST(
      jsonRequest(BASE, {
        method: 'POST',
        credential: key.rawKey,
        body: { email: 'retired@test.dev' },
      }),
      params({}),
    )
    expect(reclaim.status).toBe(409)

    // And not by anyone else either — the message is identical, so the 409
    // cannot be used to probe which addresses another tenant once held.
    const other = await createSecondOrg()
    const otherKey = await createApiKey(other.org.id, other.user.id, CREATE)
    const otherReclaim = await POST(
      jsonRequest(BASE, {
        method: 'POST',
        credential: otherKey.rawKey,
        body: { email: 'retired@test.dev' },
      }),
      params({}),
    )
    expect(otherReclaim.status).toBe(409)
    expect(await otherReclaim.json()).toEqual(await reclaim.json())
  })

  it('404s an inbox belonging to another organization, without deleting it', async () => {
    const { org, user } = await createOrgWithUser()
    const other = await createSecondOrg()
    const key = await createApiKey(org.id, user.id, DELETE_SCOPE)
    const theirs = await seedInbox(other.org.id, other.user.id)

    const res = await DELETE(
      jsonRequest(`${BASE}/${theirs.id}`, { method: 'DELETE', credential: key.rawKey }),
      params({ id: theirs.id }),
    )

    expect(res.status).toBe(404)
    const row = await prisma.emailInbox.findUniqueOrThrow({ where: { id: theirs.id } })
    expect(row.deletedAt).toBeNull()
  })

  it('is idempotent in effect — a second delete 404s rather than re-stamping', async () => {
    const { org, user } = await createOrgWithUser()
    const key = await createApiKey(org.id, user.id, DELETE_SCOPE)
    const inbox = await seedInbox(org.id, user.id)

    await DELETE(
      jsonRequest(`${BASE}/${inbox.id}`, { method: 'DELETE', credential: key.rawKey }),
      params({ id: inbox.id }),
    )
    const [first] = await prisma.$queryRawUnsafe<Array<{ deletedAt: Date }>>(
      'SELECT "deletedAt" FROM "email_inboxes" WHERE "id" = $1::uuid',
      inbox.id,
    )

    const second = await DELETE(
      jsonRequest(`${BASE}/${inbox.id}`, { method: 'DELETE', credential: key.rawKey }),
      params({ id: inbox.id }),
    )
    expect(second.status).toBe(404)

    const [after] = await prisma.$queryRawUnsafe<Array<{ deletedAt: Date }>>(
      'SELECT "deletedAt" FROM "email_inboxes" WHERE "id" = $1::uuid',
      inbox.id,
    )
    expect(after.deletedAt.getTime()).toBe(first.deletedAt.getTime())
  })
})
