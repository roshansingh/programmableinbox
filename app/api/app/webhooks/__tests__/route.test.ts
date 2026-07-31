import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const resolveUserPrincipalFromTokenMock = vi.fn()
const webhookFindManyMock = vi.fn()
const webhookCountMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  resolveUserPrincipalFromToken: (...args: unknown[]) =>
    resolveUserPrincipalFromTokenMock(...args),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    webhook: {
      findMany: (...args: unknown[]) => webhookFindManyMock(...args),
      count: (...args: unknown[]) => webhookCountMock(...args),
    },
  },
}))

async function loadRoute() {
  return await import('../route')
}

async function get(query = '') {
  const { GET } = await loadRoute()
  return GET(
    new NextRequest(`http://localhost/api/app/webhooks${query}`, {
      headers: { authorization: 'Bearer jwt.token.here' },
    }),
    { params: Promise.resolve({}) },
  )
}

/** The `{ where, skip, take, orderBy }` object handed to prisma.webhook.findMany. */
function findManyArgs() {
  return webhookFindManyMock.mock.calls[0][0]
}

describe('GET /api/app/webhooks pagination', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    resolveUserPrincipalFromTokenMock.mockResolvedValue({
      kind: 'user',
      userId: 'user_1',
      memberships: [{ organizationId: 'org_1' }],
    })
    webhookFindManyMock.mockResolvedValue([])
    webhookCountMock.mockResolvedValue(0)
  })

  it('returns 401 without authentication', async () => {
    resolveUserPrincipalFromTokenMock.mockResolvedValue(null)

    const response = await get()
    expect(response.status).toBe(401)
    expect(webhookFindManyMock).not.toHaveBeenCalled()
  })

  it('defaults to page 1, limit 20, skip 0', async () => {
    const response = await get()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(findManyArgs()).toMatchObject({ skip: 0, take: 20 })
    expect(body.data).toMatchObject({ page: 1, limit: 20, total: 0 })
  })

  it('honours a valid page and limit', async () => {
    const response = await get('?page=3&limit=25')
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(findManyArgs()).toMatchObject({ skip: 50, take: 25 })
    expect(body.data).toMatchObject({ page: 3, limit: 25 })
  })

  it('clamps a hostile ?limit=100000000 to the max instead of loading the table', async () => {
    const response = await get('?limit=100000000')
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(findManyArgs().take).toBe(100)
    expect(body.data.limit).toBe(100)
  })

  it('rejects ?limit=-1 (which Prisma reads as "from the end") and uses the default', async () => {
    const response = await get('?limit=-1')

    expect(response.status).toBe(200)
    expect(findManyArgs().take).toBe(20)
    expect(findManyArgs().take).toBeGreaterThan(0)
  })

  it('handles ?limit=0 without asking Prisma for zero rows', async () => {
    const response = await get('?limit=0')

    expect(response.status).toBe(200)
    expect(findManyArgs().take).toBe(1)
  })

  it('handles ?page=abc without a NaN skip or a 500', async () => {
    const response = await get('?page=abc')
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(findManyArgs().skip).toBe(0)
    expect(Number.isNaN(findManyArgs().skip)).toBe(false)
    expect(body.data.page).toBe(1)
  })

  it('handles ?page=abc&limit=abc together', async () => {
    const response = await get('?page=abc&limit=abc')

    expect(response.status).toBe(200)
    expect(findManyArgs()).toMatchObject({ skip: 0, take: 20 })
  })

  it('rejects exponent and Infinity notation', async () => {
    const response = await get('?limit=1e9&page=Infinity')

    expect(response.status).toBe(200)
    expect(findManyArgs()).toMatchObject({ skip: 0, take: 20 })
  })

  it('returns 400 for an offset beyond the ceiling instead of a table scan', async () => {
    const response = await get('?page=999999999&limit=20')
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.message).toContain('maximum offset')
    expect(webhookFindManyMock).not.toHaveBeenCalled()
  })

  it('still allows the deepest permitted offset', async () => {
    const response = await get('?page=501&limit=20')

    expect(response.status).toBe(200)
    expect(findManyArgs().skip).toBe(10_000)
  })

  it('preserves the { webhooks, total, page, limit } response shape', async () => {
    webhookFindManyMock.mockResolvedValue([{ id: 'wh_1' }])
    webhookCountMock.mockResolvedValue(1)

    const response = await get()
    const body = await response.json()

    expect(Object.keys(body.data).sort()).toEqual(['limit', 'page', 'total', 'webhooks'])
    expect(body.data.webhooks).toEqual([{ id: 'wh_1' }])
  })

  it('still applies the status filter alongside pagination', async () => {
    await get('?status=active&limit=5')

    expect(findManyArgs().where).toMatchObject({ status: 'active' })
    expect(findManyArgs().take).toBe(5)
  })
})

describe('GET /api/app/webhooks status validation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    resolveUserPrincipalFromTokenMock.mockResolvedValue({
      kind: 'user',
      userId: 'user_1',
      memberships: [{ organizationId: 'org_1' }],
    })
    webhookFindManyMock.mockResolvedValue([])
    webhookCountMock.mockResolvedValue(0)
  })

  it('rejects an unknown status with 400 instead of handing it to Prisma', async () => {
    // The value was cast straight to the enum, so Prisma received an invalid
    // member and raised — a bad client param surfacing as a 500.
    const response = await get('?status=wat')

    expect(response.status).toBe(400)
    expect(webhookFindManyMock).not.toHaveBeenCalled()
  })

  it('accepts every real enum member', async () => {
    for (const status of ['active', 'inactive', 'failing']) {
      vi.clearAllMocks()
      webhookFindManyMock.mockResolvedValue([])
      webhookCountMock.mockResolvedValue(0)
      const response = await get(`?status=${status}`)
      expect(response.status).toBe(200)
      expect(webhookFindManyMock.mock.calls[0][0].where.status).toBe(status)
    }
  })

  it('omits the status filter entirely when the param is absent', async () => {
    await get()
    expect(findManyArgs().where.status).toBeUndefined()
  })

  it('is case-sensitive — the enum members are lowercase', async () => {
    expect((await get('?status=ACTIVE')).status).toBe(400)
  })
})
