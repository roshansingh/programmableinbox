import { describe, it, expect } from 'vitest'
import { GET, POST } from '@/app/api/v1/apiKeys/route'
import { GET as getById, DELETE as deleteById } from '@/app/api/v1/apiKeys/[id]/route'
import { prisma } from '@/lib/db'
import { createOrgWithUser, createSecondOrg, createApiKey } from './helpers/auth'
import { jsonRequest, params } from './helpers/request'

describe('POST /api/v1/apiKeys', () => {
  it('401 without a token', async () => {
    const res = await POST(jsonRequest('http://localhost/api/v1/apiKeys', { method: 'POST', body: {} }))
    expect(res.status).toBe(401)
  })

  it('creates a key, returns the raw key once, stores only the hash', async () => {
    const { org, token } = await createOrgWithUser()
    const res = await POST(jsonRequest('http://localhost/api/v1/apiKeys', {
      method: 'POST', credential: token,
      body: { organizationId: org.id, name: 'CI', scopes: ['messages:read'] },
    }))
    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data.apiKey).toMatch(/^sk_live_/)
    const row = await prisma.apiKey.findFirstOrThrow({ where: { organizationId: org.id } })
    expect(row.apiKey).toBeNull()
    expect(row.keyHash).not.toBeNull()
  })

  it('400 on an invalid scope', async () => {
    const { org, token } = await createOrgWithUser()
    const res = await POST(jsonRequest('http://localhost/api/v1/apiKeys', {
      method: 'POST', credential: token,
      body: { organizationId: org.id, name: 'CI', scopes: ['not:a:scope'] },
    }))
    expect(res.status).toBe(400)
  })

  it('403 creating a key in an org you do not belong to', async () => {
    const { token } = await createOrgWithUser()
    const other = await createSecondOrg()
    const res = await POST(jsonRequest('http://localhost/api/v1/apiKeys', {
      method: 'POST', credential: token,
      body: { organizationId: other.org.id, name: 'x', scopes: ['messages:read'] },
    }))
    expect(res.status).toBe(403)
  })
})

describe('GET /api/v1/apiKeys', () => {
  it('401 without a token', async () => {
    const res = await GET(jsonRequest('http://localhost/api/v1/apiKeys'))
    expect(res.status).toBe(401)
  })

  it('lists only the caller\'s keys, exposing prefix+scopes but never apiKey/keyHash', async () => {
    const { org, user, token } = await createOrgWithUser()
    const mine = await createApiKey(org.id, user.id, ['inboxes:read', 'messages:read'])

    const other = await createSecondOrg()
    await createApiKey(other.org.id, other.user.id, ['messages:read'])

    const res = await GET(jsonRequest('http://localhost/api/v1/apiKeys', { credential: token }))
    expect(res.status).toBe(200)
    const { data } = await res.json()

    expect(Array.isArray(data)).toBe(true)
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe(mine.id)
    expect(data[0].prefix).toBe(mine.rawKey.slice(0, 12))
    expect(data[0].scopes).toEqual(['inboxes:read', 'messages:read'])
    expect(data[0].apiKey).toBeUndefined()
    expect(data[0].keyHash).toBeUndefined()
  })

  it('403 filtering by an organizationId the caller is not a member of', async () => {
    const { token } = await createOrgWithUser()
    const other = await createSecondOrg()
    const res = await GET(jsonRequest(`http://localhost/api/v1/apiKeys?organizationId=${other.org.id}`, {
      credential: token,
    }))
    expect(res.status).toBe(403)
  })
})

describe('GET /api/v1/apiKeys/[id]', () => {
  it('401 without a token', async () => {
    const res = await getById(
      jsonRequest('http://localhost/api/v1/apiKeys/some-id'),
      params({ id: 'some-id' })
    )
    expect(res.status).toBe(401)
  })

  it('gets the caller\'s own key', async () => {
    const { org, user, token } = await createOrgWithUser()
    const key = await createApiKey(org.id, user.id, ['messages:read'])

    const res = await getById(
      jsonRequest(`http://localhost/api/v1/apiKeys/${key.id}`, { credential: token }),
      params({ id: key.id })
    )
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.id).toBe(key.id)
    expect(data.prefix).toBe(key.rawKey.slice(0, 12))
    expect(data.apiKey).toBeUndefined()
    expect(data.keyHash).toBeUndefined()
  })

  it('404 getting another org\'s key', async () => {
    const { token } = await createOrgWithUser()
    const other = await createSecondOrg()
    const otherKey = await createApiKey(other.org.id, other.user.id, ['messages:read'])

    const res = await getById(
      jsonRequest(`http://localhost/api/v1/apiKeys/${otherKey.id}`, { credential: token }),
      params({ id: otherKey.id })
    )
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/v1/apiKeys/[id]', () => {
  it('401 without a token', async () => {
    const res = await deleteById(
      jsonRequest('http://localhost/api/v1/apiKeys/some-id', { method: 'DELETE' }),
      params({ id: 'some-id' })
    )
    expect(res.status).toBe(401)
  })

  it('revokes the key: sets revokedAt and removes it from the GET list', async () => {
    const { org, user, token } = await createOrgWithUser()
    const key = await createApiKey(org.id, user.id, ['messages:read'])

    const res = await deleteById(
      jsonRequest(`http://localhost/api/v1/apiKeys/${key.id}`, { method: 'DELETE', credential: token }),
      params({ id: key.id })
    )
    expect(res.status).toBe(204)

    const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })
    expect(row.revokedAt).not.toBeNull()

    const listRes = await GET(jsonRequest('http://localhost/api/v1/apiKeys', { credential: token }))
    const { data } = await listRes.json()
    expect(data.find((k: { id: string }) => k.id === key.id)).toBeUndefined()
  })

  it('404 deleting another org\'s key', async () => {
    const { token } = await createOrgWithUser()
    const other = await createSecondOrg()
    const otherKey = await createApiKey(other.org.id, other.user.id, ['messages:read'])

    const res = await deleteById(
      jsonRequest(`http://localhost/api/v1/apiKeys/${otherKey.id}`, { method: 'DELETE', credential: token }),
      params({ id: otherKey.id })
    )
    expect(res.status).toBe(404)

    const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: otherKey.id } })
    expect(row.revokedAt).toBeNull()
  })
})
