import { describe, it, expect } from 'vitest'
import { GET, POST } from '@/app/api/app/emailInbox/route'
import { GET as getById, PATCH as patchById, DELETE as deleteById } from '@/app/api/app/emailInbox/[id]/route'
import { prisma } from '@/lib/db'
import { createOrgWithUser, createSecondOrg } from './helpers/auth'
import { seedInbox } from './helpers/factories'
import { jsonRequest, params } from './helpers/request'

describe('POST /api/app/emailInbox', () => {
  it('401 without a token', async () => {
    const res = await POST(jsonRequest('http://localhost/api/app/emailInbox', { method: 'POST', body: {} }))
    expect(res.status).toBe(401)
  })

  it('creates an inbox scoped to the org and caller', async () => {
    const { org, user, token } = await createOrgWithUser()
    const res = await POST(jsonRequest('http://localhost/api/app/emailInbox', {
      method: 'POST', credential: token,
      body: { organizationId: org.id, email: 'new-inbox@test.dev', name: 'My Inbox' },
    }))
    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data.email).toBe('new-inbox@test.dev')
    expect(data.organizationId).toBe(org.id)

    const row = await prisma.emailInbox.findUniqueOrThrow({ where: { id: data.id } })
    expect(row.organizationId).toBe(org.id)
    expect(row.userId).toBe(user.id)
    expect(row.email).toBe('new-inbox@test.dev')
    expect(row.name).toBe('My Inbox')
  })

  it('403 creating an inbox in an org you do not belong to', async () => {
    const { token } = await createOrgWithUser()
    const other = await createSecondOrg()
    const res = await POST(jsonRequest('http://localhost/api/app/emailInbox', {
      method: 'POST', credential: token,
      body: { organizationId: other.org.id, email: 'other-inbox@test.dev' },
    }))
    expect(res.status).toBe(403)
  })

  it('400 without organizationId or email', async () => {
    const { org, token } = await createOrgWithUser()
    const res = await POST(jsonRequest('http://localhost/api/app/emailInbox', {
      method: 'POST', credential: token,
      body: { organizationId: org.id },
    }))
    expect(res.status).toBe(400)
  })

  it('409 on a duplicate email address (globally unique)', async () => {
    const { org, user, token } = await createOrgWithUser()
    await seedInbox(org.id, user.id, { email: 'dupe@test.dev' })

    const other = await createSecondOrg()
    const res = await POST(jsonRequest('http://localhost/api/app/emailInbox', {
      method: 'POST', credential: other.token,
      body: { organizationId: other.org.id, email: 'dupe@test.dev' },
    }))
    expect(res.status).toBe(409)
  })
})

describe('GET /api/app/emailInbox', () => {
  it('401 without a token', async () => {
    const res = await GET(jsonRequest('http://localhost/api/app/emailInbox'))
    expect(res.status).toBe(401)
  })

  it('lists only the caller\'s own inboxes, not another org\'s', async () => {
    const { org, user, token } = await createOrgWithUser()
    const mine = await seedInbox(org.id, user.id)

    const other = await createSecondOrg()
    await seedInbox(other.org.id, other.user.id)

    const res = await GET(jsonRequest('http://localhost/api/app/emailInbox', { credential: token }))
    expect(res.status).toBe(200)
    const { data } = await res.json()

    expect(Array.isArray(data)).toBe(true)
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe(mine.id)
  })
})

describe('GET /api/app/emailInbox/[id]', () => {
  it('401 without a token', async () => {
    const res = await getById(
      jsonRequest('http://localhost/api/app/emailInbox/some-id'),
      params({ id: 'some-id' })
    )
    expect(res.status).toBe(401)
  })

  it('gets the caller\'s own inbox', async () => {
    const { org, user, token } = await createOrgWithUser()
    const inbox = await seedInbox(org.id, user.id)

    const res = await getById(
      jsonRequest(`http://localhost/api/app/emailInbox/${inbox.id}`, { credential: token }),
      params({ id: inbox.id })
    )
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.id).toBe(inbox.id)
    expect(data.email).toBe(inbox.email)
  })

  it('404 getting another org\'s inbox', async () => {
    const { token } = await createOrgWithUser()
    const other = await createSecondOrg()
    const otherInbox = await seedInbox(other.org.id, other.user.id)

    const res = await getById(
      jsonRequest(`http://localhost/api/app/emailInbox/${otherInbox.id}`, { credential: token }),
      params({ id: otherInbox.id })
    )
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/app/emailInbox/[id]', () => {
  it('401 without a token', async () => {
    const res = await patchById(
      jsonRequest('http://localhost/api/app/emailInbox/some-id', { method: 'PATCH', body: {} }),
      params({ id: 'some-id' })
    )
    expect(res.status).toBe(401)
  })

  it('updates the caller\'s own inbox', async () => {
    const { org, user, token } = await createOrgWithUser()
    const inbox = await seedInbox(org.id, user.id)

    const res = await patchById(
      jsonRequest(`http://localhost/api/app/emailInbox/${inbox.id}`, {
        method: 'PATCH', credential: token,
        body: { name: 'Renamed Inbox' },
      }),
      params({ id: inbox.id })
    )
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.name).toBe('Renamed Inbox')

    const row = await prisma.emailInbox.findUniqueOrThrow({ where: { id: inbox.id } })
    expect(row.name).toBe('Renamed Inbox')
  })

  it('409 renaming onto an email another inbox already holds', async () => {
    const { org, user, token } = await createOrgWithUser()
    const inbox = await seedInbox(org.id, user.id)
    await seedInbox(org.id, user.id, { email: 'taken@test.dev' })

    const res = await patchById(
      jsonRequest(`http://localhost/api/app/emailInbox/${inbox.id}`, {
        method: 'PATCH', credential: token,
        body: { email: 'taken@test.dev' },
      }),
      params({ id: inbox.id })
    )
    expect(res.status).toBe(409)
  })

  it('404 updating another org\'s inbox', async () => {
    const { token } = await createOrgWithUser()
    const other = await createSecondOrg()
    const otherInbox = await seedInbox(other.org.id, other.user.id)

    const res = await patchById(
      jsonRequest(`http://localhost/api/app/emailInbox/${otherInbox.id}`, {
        method: 'PATCH', credential: token,
        body: { name: 'Hijacked' },
      }),
      params({ id: otherInbox.id })
    )
    expect(res.status).toBe(404)

    const row = await prisma.emailInbox.findUniqueOrThrow({ where: { id: otherInbox.id } })
    expect(row.name).not.toBe('Hijacked')
  })
})

describe('DELETE /api/app/emailInbox/[id]', () => {
  it('401 without a token', async () => {
    const res = await deleteById(
      jsonRequest('http://localhost/api/app/emailInbox/some-id', { method: 'DELETE' }),
      params({ id: 'some-id' })
    )
    expect(res.status).toBe(401)
  })

  it('soft-deletes the inbox: sets deletedAt, hides it from GET/list, but keeps the row (and its email claim)', async () => {
    const { org, user, token } = await createOrgWithUser()
    const inbox = await seedInbox(org.id, user.id)

    const res = await deleteById(
      jsonRequest(`http://localhost/api/app/emailInbox/${inbox.id}`, { method: 'DELETE', credential: token }),
      params({ id: inbox.id })
    )
    expect(res.status).toBe(204)

    // Row still exists in the DB with deletedAt set (soft delete, not a hard delete).
    const row = await prisma.emailInbox.findFirst({ where: { id: inbox.id, deletedAt: { not: null } } })
    expect(row).not.toBeNull()
    expect(row!.deletedAt).not.toBeNull()
    expect(row!.email).toBe(inbox.email)

    // Disappears from GET by id (soft-delete filter applied on read).
    const getRes = await getById(
      jsonRequest(`http://localhost/api/app/emailInbox/${inbox.id}`, { credential: token }),
      params({ id: inbox.id })
    )
    expect(getRes.status).toBe(404)

    // Disappears from the list too.
    const listRes = await GET(jsonRequest('http://localhost/api/app/emailInbox', { credential: token }))
    const { data } = await listRes.json()
    expect(data.find((i: { id: string }) => i.id === inbox.id)).toBeUndefined()
  })

  it('404 deleting another org\'s inbox, and does not soft-delete it', async () => {
    const { token } = await createOrgWithUser()
    const other = await createSecondOrg()
    const otherInbox = await seedInbox(other.org.id, other.user.id)

    const res = await deleteById(
      jsonRequest(`http://localhost/api/app/emailInbox/${otherInbox.id}`, { method: 'DELETE', credential: token }),
      params({ id: otherInbox.id })
    )
    expect(res.status).toBe(404)

    const row = await prisma.emailInbox.findUniqueOrThrow({ where: { id: otherInbox.id } })
    expect(row.deletedAt).toBeNull()
  })
})
