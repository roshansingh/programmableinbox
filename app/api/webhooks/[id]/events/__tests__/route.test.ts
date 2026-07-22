import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const getAuthenticatedUserMock = vi.fn()
const webhookFindUniqueMock = vi.fn()
const webhookEventFindManyMock = vi.fn()
const webhookEventCountMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  getAuthenticatedUser: (...args: unknown[]) => getAuthenticatedUserMock(...args),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    webhook: {
      findUnique: (...args: unknown[]) => webhookFindUniqueMock(...args),
    },
    webhookEvent: {
      findMany: (...args: unknown[]) => webhookEventFindManyMock(...args),
      count: (...args: unknown[]) => webhookEventCountMock(...args),
    },
  },
}))

async function loadRoute() {
  return await import('../route')
}

async function get(query = '') {
  const { GET } = await loadRoute()
  return GET(new NextRequest(`http://localhost/api/webhooks/wh_1/events${query}`), {
    params: Promise.resolve({ id: 'wh_1' }),
  })
}

function findManyArgs() {
  return webhookEventFindManyMock.mock.calls[0][0]
}

describe('GET /api/webhooks/[id]/events pagination', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    getAuthenticatedUserMock.mockResolvedValue({
      id: 'user_1',
      memberships: [{ organizationId: 'org_1' }],
    })
    webhookFindUniqueMock.mockResolvedValue({ id: 'wh_1', organizationId: 'org_1' })
    webhookEventFindManyMock.mockResolvedValue([])
    webhookEventCountMock.mockResolvedValue(0)
  })

  it('returns 401 without authentication', async () => {
    getAuthenticatedUserMock.mockResolvedValue(null)

    const response = await get()
    expect(response.status).toBe(401)
  })

  it('returns 404 for a webhook in another organization', async () => {
    webhookFindUniqueMock.mockResolvedValue({ id: 'wh_1', organizationId: 'org_other' })

    const response = await get()
    expect(response.status).toBe(404)
    expect(webhookEventFindManyMock).not.toHaveBeenCalled()
  })

  it('defaults to page 1, limit 20, skip 0', async () => {
    const response = await get()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(findManyArgs()).toMatchObject({ skip: 0, take: 20 })
    expect(body.data).toMatchObject({ page: 1, limit: 20 })
  })

  it('clamps a hostile ?limit=100000000', async () => {
    const response = await get('?limit=100000000')

    expect(response.status).toBe(200)
    expect(findManyArgs().take).toBe(100)
  })

  it('rejects ?limit=-1', async () => {
    const response = await get('?limit=-1')

    expect(response.status).toBe(200)
    expect(findManyArgs().take).toBe(20)
  })

  it('handles ?page=abc without NaN skip or a 500', async () => {
    const response = await get('?page=abc')

    expect(response.status).toBe(200)
    expect(findManyArgs().skip).toBe(0)
  })

  it('returns 400 beyond the offset ceiling', async () => {
    const response = await get('?page=999999999')
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.message).toContain('maximum offset')
    expect(webhookEventFindManyMock).not.toHaveBeenCalled()
  })

  it('preserves the { events, total, page, limit } response shape', async () => {
    webhookEventFindManyMock.mockResolvedValue([{ id: 'ev_1' }])
    webhookEventCountMock.mockResolvedValue(1)

    const response = await get()
    const body = await response.json()

    expect(Object.keys(body.data).sort()).toEqual(['events', 'limit', 'page', 'total'])
    expect(body.data.events).toEqual([{ id: 'ev_1' }])
  })

  it('still applies the status filter alongside pagination', async () => {
    await get('?status=failed&limit=5')

    expect(findManyArgs().where).toMatchObject({ webhookId: 'wh_1', status: 'failed' })
    expect(findManyArgs().take).toBe(5)
  })
})
