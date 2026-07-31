import { describe, it, expect } from 'vitest'
import { GET, POST } from '@/app/api/app/phoneInbox/route'
import { GET as getById, PATCH as patchById, DELETE as deleteById } from '@/app/api/app/phoneInbox/[id]/route'
import { prisma } from '@/lib/db'
import { createOrgWithUser, createSecondOrg } from './helpers/auth'
import { jsonRequest, params } from './helpers/request'

function seedPhoneInbox(orgId: string, userId: string, over: { phoneNumber?: string; countryCode?: string } = {}) {
  return prisma.phoneInbox.create({
    data: {
      organizationId: orgId,
      userId,
      phoneNumber: over.phoneNumber ?? '+15550000000',
      countryCode: over.countryCode ?? 'US',
    },
  })
}

describe('POST /api/app/phoneInbox', () => {
  it('401 without a token', async () => {
    const res = await POST(jsonRequest('http://localhost/api/app/phoneInbox', { method: 'POST', body: {} }))
    expect(res.status).toBe(401)
  })

  it('creates a phone inbox scoped to the org and caller', async () => {
    const { org, user, token } = await createOrgWithUser()
    const res = await POST(jsonRequest('http://localhost/api/app/phoneInbox', {
      method: 'POST', credential: token,
      body: { organizationId: org.id, phoneNumber: '+15551234567', countryCode: 'US' },
    }))
    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data.phoneNumber).toBe('+15551234567')
    expect(data.countryCode).toBe('US')
    expect(data.organizationId).toBe(org.id)

    const row = await prisma.phoneInbox.findUniqueOrThrow({ where: { id: data.id } })
    expect(row.organizationId).toBe(org.id)
    expect(row.userId).toBe(user.id)
    expect(row.phoneNumber).toBe('+15551234567')
    expect(row.countryCode).toBe('US')
  })

  it('403 creating a phone inbox in an org you do not belong to', async () => {
    const { token } = await createOrgWithUser()
    const other = await createSecondOrg()
    const res = await POST(jsonRequest('http://localhost/api/app/phoneInbox', {
      method: 'POST', credential: token,
      body: { organizationId: other.org.id, phoneNumber: '+15559876543', countryCode: 'US' },
    }))
    expect(res.status).toBe(403)
  })

  it('400 without organizationId, phoneNumber, or countryCode', async () => {
    const { org, token } = await createOrgWithUser()
    const res = await POST(jsonRequest('http://localhost/api/app/phoneInbox', {
      method: 'POST', credential: token,
      body: { organizationId: org.id },
    }))
    expect(res.status).toBe(400)
  })
})

describe('GET /api/app/phoneInbox', () => {
  it('401 without a token', async () => {
    const res = await GET(jsonRequest('http://localhost/api/app/phoneInbox'))
    expect(res.status).toBe(401)
  })

  it('lists only the caller\'s own phone inboxes, not another org\'s', async () => {
    const { org, user, token } = await createOrgWithUser()
    const mine = await seedPhoneInbox(org.id, user.id)

    const other = await createSecondOrg()
    await seedPhoneInbox(other.org.id, other.user.id)

    const res = await GET(jsonRequest('http://localhost/api/app/phoneInbox', { credential: token }))
    expect(res.status).toBe(200)
    const { data } = await res.json()

    expect(Array.isArray(data)).toBe(true)
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe(mine.id)
  })
})

describe('GET /api/app/phoneInbox/[id]', () => {
  it('401 without a token', async () => {
    const res = await getById(
      jsonRequest('http://localhost/api/app/phoneInbox/some-id'),
      params({ id: 'some-id' })
    )
    expect(res.status).toBe(401)
  })

  it('gets the caller\'s own phone inbox', async () => {
    const { org, user, token } = await createOrgWithUser()
    const inbox = await seedPhoneInbox(org.id, user.id)

    const res = await getById(
      jsonRequest(`http://localhost/api/app/phoneInbox/${inbox.id}`, { credential: token }),
      params({ id: inbox.id })
    )
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.id).toBe(inbox.id)
    expect(data.phoneNumber).toBe(inbox.phoneNumber)
  })

  it('404 getting another org\'s phone inbox', async () => {
    const { token } = await createOrgWithUser()
    const other = await createSecondOrg()
    const otherInbox = await seedPhoneInbox(other.org.id, other.user.id)

    const res = await getById(
      jsonRequest(`http://localhost/api/app/phoneInbox/${otherInbox.id}`, { credential: token }),
      params({ id: otherInbox.id })
    )
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/app/phoneInbox/[id]', () => {
  it('401 without a token', async () => {
    const res = await patchById(
      jsonRequest('http://localhost/api/app/phoneInbox/some-id', { method: 'PATCH', body: {} }),
      params({ id: 'some-id' })
    )
    expect(res.status).toBe(401)
  })

  it('updates the caller\'s own phone inbox', async () => {
    const { org, user, token } = await createOrgWithUser()
    const inbox = await seedPhoneInbox(org.id, user.id)

    const res = await patchById(
      jsonRequest(`http://localhost/api/app/phoneInbox/${inbox.id}`, {
        method: 'PATCH', credential: token,
        body: { phoneNumber: '+15557654321', countryCode: 'CA' },
      }),
      params({ id: inbox.id })
    )
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.phoneNumber).toBe('+15557654321')
    expect(data.countryCode).toBe('CA')

    const row = await prisma.phoneInbox.findUniqueOrThrow({ where: { id: inbox.id } })
    expect(row.phoneNumber).toBe('+15557654321')
    expect(row.countryCode).toBe('CA')
  })

  it('404 updating another org\'s phone inbox', async () => {
    const { token } = await createOrgWithUser()
    const other = await createSecondOrg()
    const otherInbox = await seedPhoneInbox(other.org.id, other.user.id)

    const res = await patchById(
      jsonRequest(`http://localhost/api/app/phoneInbox/${otherInbox.id}`, {
        method: 'PATCH', credential: token,
        body: { phoneNumber: '+19998887777' },
      }),
      params({ id: otherInbox.id })
    )
    expect(res.status).toBe(404)

    const row = await prisma.phoneInbox.findUniqueOrThrow({ where: { id: otherInbox.id } })
    expect(row.phoneNumber).not.toBe('+19998887777')
  })
})

describe('DELETE /api/app/phoneInbox/[id]', () => {
  it('401 without a token', async () => {
    const res = await deleteById(
      jsonRequest('http://localhost/api/app/phoneInbox/some-id', { method: 'DELETE' }),
      params({ id: 'some-id' })
    )
    expect(res.status).toBe(401)
  })

  it('soft-deletes the phone inbox: sets deletedAt, hides it from GET/list, but keeps the row', async () => {
    const { org, user, token } = await createOrgWithUser()
    const inbox = await seedPhoneInbox(org.id, user.id)

    const res = await deleteById(
      jsonRequest(`http://localhost/api/app/phoneInbox/${inbox.id}`, { method: 'DELETE', credential: token }),
      params({ id: inbox.id })
    )
    expect(res.status).toBe(204)

    // Row still exists in the DB with deletedAt set (soft delete, not a hard delete).
    const row = await prisma.phoneInbox.findFirst({ where: { id: inbox.id, deletedAt: { not: null } } })
    expect(row).not.toBeNull()
    expect(row!.deletedAt).not.toBeNull()
    expect(row!.phoneNumber).toBe(inbox.phoneNumber)

    // Disappears from GET by id (soft-delete filter applied on read).
    const getRes = await getById(
      jsonRequest(`http://localhost/api/app/phoneInbox/${inbox.id}`, { credential: token }),
      params({ id: inbox.id })
    )
    expect(getRes.status).toBe(404)

    // Disappears from the list too.
    const listRes = await GET(jsonRequest('http://localhost/api/app/phoneInbox', { credential: token }))
    const { data } = await listRes.json()
    expect(data.find((i: { id: string }) => i.id === inbox.id)).toBeUndefined()
  })

  it('404 deleting another org\'s phone inbox, and does not soft-delete it', async () => {
    const { token } = await createOrgWithUser()
    const other = await createSecondOrg()
    const otherInbox = await seedPhoneInbox(other.org.id, other.user.id)

    const res = await deleteById(
      jsonRequest(`http://localhost/api/app/phoneInbox/${otherInbox.id}`, { method: 'DELETE', credential: token }),
      params({ id: otherInbox.id })
    )
    expect(res.status).toBe(404)

    const row = await prisma.phoneInbox.findUniqueOrThrow({ where: { id: otherInbox.id } })
    expect(row.deletedAt).toBeNull()
  })
})
