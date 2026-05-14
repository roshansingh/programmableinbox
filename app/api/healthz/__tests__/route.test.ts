import { describe, expect, it, vi, beforeEach } from 'vitest'

const findManyMock = vi.fn()
const queryRawMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRawMock(...args),
    backupStatus: {
      findMany: (...args: unknown[]) => findManyMock(...args),
    },
  },
}))

async function loadRoute() {
  return await import('../route')
}

describe('GET /api/healthz', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
  })

  it('returns 200 with db ok and fresh backups when everything is healthy', async () => {
    queryRawMock.mockResolvedValue([{ '?column?': 1 }])
    const now = new Date()
    const fresh = new Date(now.getTime() - 60 * 1000)
    findManyMock.mockResolvedValue([
      { jobName: 'walg-wal', lastSuccessAt: fresh, details: null },
      { jobName: 'walg-base', lastSuccessAt: fresh, details: null },
      { jobName: 'restic-pgdump', lastSuccessAt: fresh, details: null },
      { jobName: 'rclone-mirror', lastSuccessAt: fresh, details: null },
    ])

    const { GET } = await loadRoute()
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.status).toBe('ok')
    expect(body.data.db).toBe('ok')
    expect(body.data.freshness_breach).toBe(false)
    expect(body.data.backups).toMatchObject({
      'walg-wal': fresh.toISOString(),
      'walg-base': fresh.toISOString(),
      'restic-pgdump': fresh.toISOString(),
      'rclone-mirror': fresh.toISOString(),
    })
  })

  it('returns 503 when the database query fails', async () => {
    queryRawMock.mockRejectedValue(new Error('connection refused'))
    findManyMock.mockResolvedValue([])

    const { GET } = await loadRoute()
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.data.status).toBe('degraded')
    expect(body.data.db).toBe('error')
  })

  it('returns 503 when walg-wal is older than 10 minutes', async () => {
    queryRawMock.mockResolvedValue([{ '?column?': 1 }])
    const now = new Date()
    const stale = new Date(now.getTime() - 15 * 60 * 1000)
    findManyMock.mockResolvedValue([
      { jobName: 'walg-wal', lastSuccessAt: stale, details: null },
    ])

    const { GET } = await loadRoute()
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.data.freshness_breach).toBe(true)
    expect(body.data.stale_jobs).toContain('walg-wal')
  })

  it('returns 503 when walg-base is older than 26 hours', async () => {
    queryRawMock.mockResolvedValue([{ '?column?': 1 }])
    const now = new Date()
    const stale = new Date(now.getTime() - 27 * 60 * 60 * 1000)
    findManyMock.mockResolvedValue([
      { jobName: 'walg-wal', lastSuccessAt: now, details: null },
      { jobName: 'walg-base', lastSuccessAt: stale, details: null },
    ])

    const { GET } = await loadRoute()
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.data.freshness_breach).toBe(true)
    expect(body.data.stale_jobs).toContain('walg-base')
  })

  it('returns 200 but marks a job missing if the row is absent (allows first boot)', async () => {
    queryRawMock.mockResolvedValue([{ '?column?': 1 }])
    findManyMock.mockResolvedValue([])

    const { GET } = await loadRoute()
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.backups).toEqual({})
    expect(body.data.freshness_breach).toBe(false)
  })
})
