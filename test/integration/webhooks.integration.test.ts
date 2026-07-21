import { describe, it, expect } from 'vitest'
import { GET, POST } from '@/app/api/webhooks/route'
import { GET as getById, PATCH as patchById, DELETE as deleteById } from '@/app/api/webhooks/[id]/route'
import { prisma } from '@/lib/db'
import { createOrgWithUser, createSecondOrg } from './helpers/auth'
import { seedWebhook } from './helpers/factories'
import { jsonRequest, params } from './helpers/request'

describe('POST /api/webhooks', () => {
  it('401 without a token', async () => {
    const res = await POST(jsonRequest('http://localhost/api/webhooks', { method: 'POST', body: {} }))
    expect(res.status).toBe(401)
  })

  it('creates a webhook scoped to the caller\'s org', async () => {
    const { org, token } = await createOrgWithUser()
    const res = await POST(jsonRequest('http://localhost/api/webhooks', {
      method: 'POST', credential: token,
      body: { name: 'CI Hook', url: 'https://example.test/hook', events: ['email.received'] },
    }))
    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data.name).toBe('CI Hook')
    expect(data.url).toBe('https://example.test/hook')
    expect(data.organizationId).toBe(org.id)

    const row = await prisma.webhook.findUniqueOrThrow({ where: { id: data.id } })
    expect(row.organizationId).toBe(org.id)
    expect(row.name).toBe('CI Hook')
    expect(row.events).toEqual(['email.received'])
  })

  it('400 without name, url, or events', async () => {
    const { token } = await createOrgWithUser()
    const res = await POST(jsonRequest('http://localhost/api/webhooks', {
      method: 'POST', credential: token,
      body: { name: 'No URL' },
    }))
    expect(res.status).toBe(400)
  })
})

describe('GET /api/webhooks', () => {
  it('401 without a token', async () => {
    const res = await GET(jsonRequest('http://localhost/api/webhooks'))
    expect(res.status).toBe(401)
  })

  it('lists only the caller\'s own org\'s webhooks, not another org\'s', async () => {
    const { org, token } = await createOrgWithUser()
    const mine = await seedWebhook(org.id)

    const other = await createSecondOrg()
    await seedWebhook(other.org.id)

    const res = await GET(jsonRequest('http://localhost/api/webhooks', { credential: token }))
    expect(res.status).toBe(200)
    const { data } = await res.json()

    expect(Array.isArray(data.webhooks)).toBe(true)
    expect(data.webhooks).toHaveLength(1)
    expect(data.webhooks[0].id).toBe(mine.id)
    expect(data.total).toBe(1)
  })
})

describe('GET /api/webhooks/[id]', () => {
  it('401 without a token', async () => {
    const res = await getById(
      jsonRequest('http://localhost/api/webhooks/some-id'),
      params({ id: 'some-id' })
    )
    expect(res.status).toBe(401)
  })

  it('gets the caller\'s own org\'s webhook', async () => {
    const { org, token } = await createOrgWithUser()
    const webhook = await seedWebhook(org.id)

    const res = await getById(
      jsonRequest(`http://localhost/api/webhooks/${webhook.id}`, { credential: token }),
      params({ id: webhook.id })
    )
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.id).toBe(webhook.id)
    expect(data.url).toBe(webhook.url)
  })

  it('404 getting another org\'s webhook', async () => {
    const { token } = await createOrgWithUser()
    const other = await createSecondOrg()
    const otherWebhook = await seedWebhook(other.org.id)

    const res = await getById(
      jsonRequest(`http://localhost/api/webhooks/${otherWebhook.id}`, { credential: token }),
      params({ id: otherWebhook.id })
    )
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/webhooks/[id]', () => {
  it('401 without a token', async () => {
    const res = await patchById(
      jsonRequest('http://localhost/api/webhooks/some-id', { method: 'PATCH', body: {} }),
      params({ id: 'some-id' })
    )
    expect(res.status).toBe(401)
  })

  it('updates the caller\'s own org\'s webhook', async () => {
    const { org, token } = await createOrgWithUser()
    const webhook = await seedWebhook(org.id)

    const res = await patchById(
      jsonRequest(`http://localhost/api/webhooks/${webhook.id}`, {
        method: 'PATCH', credential: token,
        body: { name: 'Renamed Hook', status: 'inactive' },
      }),
      params({ id: webhook.id })
    )
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.name).toBe('Renamed Hook')
    expect(data.status).toBe('inactive')

    const row = await prisma.webhook.findUniqueOrThrow({ where: { id: webhook.id } })
    expect(row.name).toBe('Renamed Hook')
    expect(row.status).toBe('inactive')
  })

  it('404 updating another org\'s webhook, and does not modify it', async () => {
    const { token } = await createOrgWithUser()
    const other = await createSecondOrg()
    const otherWebhook = await seedWebhook(other.org.id)

    const res = await patchById(
      jsonRequest(`http://localhost/api/webhooks/${otherWebhook.id}`, {
        method: 'PATCH', credential: token,
        body: { name: 'Hijacked' },
      }),
      params({ id: otherWebhook.id })
    )
    expect(res.status).toBe(404)

    const row = await prisma.webhook.findUniqueOrThrow({ where: { id: otherWebhook.id } })
    expect(row.name).not.toBe('Hijacked')
  })
})

describe('DELETE /api/webhooks/[id]', () => {
  it('401 without a token', async () => {
    const res = await deleteById(
      jsonRequest('http://localhost/api/webhooks/some-id', { method: 'DELETE' }),
      params({ id: 'some-id' })
    )
    expect(res.status).toBe(401)
  })

  it('soft-deletes the webhook: sets deletedAt, hides it from GET/list, but keeps the row', async () => {
    const { org, token } = await createOrgWithUser()
    const webhook = await seedWebhook(org.id)

    const res = await deleteById(
      jsonRequest(`http://localhost/api/webhooks/${webhook.id}`, { method: 'DELETE', credential: token }),
      params({ id: webhook.id })
    )
    expect(res.status).toBe(204)

    // Row still exists in the DB with deletedAt set (soft delete, not a hard delete).
    const row = await prisma.webhook.findFirst({ where: { id: webhook.id, deletedAt: { not: null } } })
    expect(row).not.toBeNull()
    expect(row!.deletedAt).not.toBeNull()
    expect(row!.url).toBe(webhook.url)

    // Disappears from GET by id (soft-delete filter applied on read).
    const getRes = await getById(
      jsonRequest(`http://localhost/api/webhooks/${webhook.id}`, { credential: token }),
      params({ id: webhook.id })
    )
    expect(getRes.status).toBe(404)

    // Disappears from the list too.
    const listRes = await GET(jsonRequest('http://localhost/api/webhooks', { credential: token }))
    const { data } = await listRes.json()
    expect(data.webhooks.find((w: { id: string }) => w.id === webhook.id)).toBeUndefined()
  })

  it('404 deleting another org\'s webhook, and does not soft-delete it', async () => {
    const { token } = await createOrgWithUser()
    const other = await createSecondOrg()
    const otherWebhook = await seedWebhook(other.org.id)

    const res = await deleteById(
      jsonRequest(`http://localhost/api/webhooks/${otherWebhook.id}`, { method: 'DELETE', credential: token }),
      params({ id: otherWebhook.id })
    )
    expect(res.status).toBe(404)

    const row = await prisma.webhook.findUniqueOrThrow({ where: { id: otherWebhook.id } })
    expect(row.deletedAt).toBeNull()
  })
})
