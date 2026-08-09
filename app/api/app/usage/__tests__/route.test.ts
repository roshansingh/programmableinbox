import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const resolveUserPrincipalFromTokenMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  resolveUserPrincipalFromToken: (...a: unknown[]) => resolveUserPrincipalFromTokenMock(...a),
}))

function request(query = '') {
  return new NextRequest(`http://localhost:3000/api/app/usage${query}`, {
    headers: { authorization: 'Bearer token' },
  })
}

const ctx = { params: Promise.resolve({}) }

async function configure(peekResult = { limit: 1000, used: 250, resetsAt: null as Date | null }) {
  const { CommercialProvider } = await import('@/lib/commercial/provider')
  const { UNLIMITED } = await import('@/lib/commercial/plan-limits')
  const peek = vi.fn().mockResolvedValue({ allowed: true, ...peekResult })

  CommercialProvider.configure(
    {
      resolve: async () => ({
        planCode: 'free',
        planName: 'Free',
        limits: { ...UNLIMITED, incomingEmailsPerPeriod: 1000 },
        periodStart: null,
        periodEnd: null,
      }),
    },
    { consume: vi.fn(), refund: vi.fn(), peek, increment: vi.fn() },
    CommercialProvider.metering,
  )
  return { peek, CommercialProvider }
}

describe('GET /api/app/usage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveUserPrincipalFromTokenMock.mockResolvedValue({
      kind: 'user',
      userId: 'user_1',
      emailVerified: true,
      memberships: [{ organizationId: 'org_1', role: 'owner' }],
    })
  })

  afterEach(async () => {
    const { CommercialProvider } = await import('@/lib/commercial/provider')
    CommercialProvider.reset()
  })

  it('resolves the single membership when no organizationId is given', async () => {
    await configure()
    const { GET } = await import('../route')

    const response = await GET(request(), ctx)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.organizationId).toBe('org_1')
  })

  it('reports limit, used and resetsAt for every metric', async () => {
    await configure({ limit: 1000, used: 250, resetsAt: new Date('2026-09-01T00:00:00Z') })
    const { GET } = await import('../route')

    const body = await (await GET(request(), ctx)).json()

    expect(body.data.usage).toContainEqual({
      metric: 'emails.processed',
      limit: 1000,
      used: 250,
      resetsAt: '2026-09-01T00:00:00.000Z',
    })
  })

  /**
   * `emails.dropped` has no limit, but on a `drop` plan it is the number that
   * actually motivates an upgrade — "at your limit" says nothing about how much
   * mail was lost.
   */
  it('includes the report-only dropped counter', async () => {
    await configure()
    const { GET } = await import('../route')

    const body = await (await GET(request(), ctx)).json()

    expect(body.data.usage.map((u: { metric: string }) => u.metric)).toContain('emails.dropped')
  })

  it('carries the plan so the UI can render limits alongside usage', async () => {
    await configure()
    const { GET } = await import('../route')

    const body = await (await GET(request(), ctx)).json()

    expect(body.data.plan).toMatchObject({ code: 'free', name: 'Free' })
  })

  it('never exposes the numeric plan id', async () => {
    await configure()
    const { GET } = await import('../route')

    const body = await (await GET(request(), ctx)).json()

    expect(body.data.plan).not.toHaveProperty('id')
  })

  /**
   * Usage is per-organization, so with several memberships and no explicit
   * parameter there is no correct answer — better a 400 asking for one than a
   * silent pick.
   */
  it('400s when the user belongs to several organizations and names none', async () => {
    resolveUserPrincipalFromTokenMock.mockResolvedValue({
      kind: 'user',
      userId: 'user_1',
      emailVerified: true,
      memberships: [{ organizationId: 'org_1' }, { organizationId: 'org_2' }],
    })
    await configure()
    const { GET } = await import('../route')

    const response = await GET(request(), ctx)

    expect(response.status).toBe(400)
  })

  /**
   * The membership check is `toOrgScope`'s, not this route's — routing through
   * it is what stops the endpoint becoming a second, weaker tenancy predicate.
   */
  it('403s for an organization the user does not belong to', async () => {
    await configure()
    const { GET } = await import('../route')

    const response = await GET(request('?organizationId=org_other'), ctx)

    expect(response.status).toBe(403)
  })

  it('reports unlimited under the OSS default', async () => {
    const { GET } = await import('../route')

    const body = await (await GET(request(), ctx)).json()

    expect(body.data.plan.code).toBe('self_hosted')
    for (const entry of body.data.usage) {
      expect(entry.limit).toBeNull()
    }
  })
})
