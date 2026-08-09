import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UNLIMITED } from '@/lib/commercial/plan-limits'
import type { IPlanResolver } from '@/lib/commercial/interfaces'

const mockQueryRaw = vi.fn()
const mockExecuteRaw = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: { $queryRaw: mockQueryRaw, $executeRaw: mockExecuteRaw },
}))

const PERIOD_START = new Date('2026-08-01T00:00:00Z')
const PERIOD_END = new Date('2026-09-01T00:00:00Z')

function resolverFor(overrides: Partial<typeof UNLIMITED>): IPlanResolver {
  return {
    resolve: async () => ({
      planCode: 'free',
      planName: 'Free',
      limits: { ...UNLIMITED, ...overrides },
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    }),
  }
}

async function quotaWith(overrides: Partial<typeof UNLIMITED>) {
  const { PostgresQuota } = await import('../quota')
  return new PostgresQuota(resolverFor(overrides))
}

describe('PostgresQuota.consume', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQueryRaw.mockResolvedValue([{ value: 1 }])
    mockExecuteRaw.mockResolvedValue(1)
  })

  it('allows and reports no cap when the metric is unlimited', async () => {
    const quota = await quotaWith({ incomingEmailsPerPeriod: null })

    const result = await quota.consume('org-1', 'emails.processed', 1)

    expect(result.allowed).toBe(true)
    expect(result.limit).toBeNull()
  })

  it('allows while under the limit and reports the new usage', async () => {
    mockQueryRaw.mockResolvedValue([{ value: 42 }])
    const quota = await quotaWith({ incomingEmailsPerPeriod: 1000 })

    const result = await quota.consume('org-1', 'emails.processed', 1)

    expect(result.allowed).toBe(true)
    expect(result.limit).toBe(1000)
    expect(result.used).toBe(42)
    expect(result.resetsAt).toEqual(PERIOD_END)
  })

  /**
   * The statement returns no row when its guard fails, which is how "denied"
   * and "nothing consumed" become the same fact rather than two steps that can
   * disagree.
   */
  it('denies without consuming when the guarded statement returns no row', async () => {
    mockQueryRaw.mockResolvedValue([])
    const quota = await quotaWith({ incomingEmailsPerPeriod: 1000, overQuotaBehavior: 'drop' })

    const result = await quota.consume('org-1', 'emails.processed', 1)

    expect(result.allowed).toBe(false)
    expect(result.used).toBe(1000)
    expect(result.limit).toBe(1000)
  })

  /**
   * `overage` never refuses work — a paying customer's mail must not stop — but
   * it still counts, so the excess can be surfaced or billed.
   */
  it('allows past the cap when overQuotaBehavior is overage, and still counts', async () => {
    mockQueryRaw.mockResolvedValue([{ value: 1200 }])
    const quota = await quotaWith({ incomingEmailsPerPeriod: 1000, overQuotaBehavior: 'overage' })

    const result = await quota.consume('org-1', 'emails.processed', 1)

    expect(result.allowed).toBe(true)
    expect(result.used).toBe(1200)
    expect(result.limit).toBe(1000)
  })

  /**
   * `emails.dropped` is report-only: it has no limit key, and refusing to
   * record a drop would defeat the counter's entire purpose.
   */
  it('never denies a report-only metric', async () => {
    const quota = await quotaWith({ incomingEmailsPerPeriod: 0 })

    const result = await quota.consume('org-1', 'emails.dropped', 1)

    expect(result.allowed).toBe(true)
    expect(result.limit).toBeNull()
  })

  it('maps each metric to its own limit key', async () => {
    const quota = await quotaWith({ outboundEmailsPerPeriod: 7, incomingEmailsPerPeriod: 1000 })

    expect((await quota.consume('org-1', 'emails.sent', 1)).limit).toBe(7)
    expect((await quota.consume('org-1', 'emails.processed', 1)).limit).toBe(1000)
  })

  /**
   * A zero limit means "none allowed" and must not be read as unlimited —
   * `null` and `0` are both falsy, which is the bug this guards.
   */
  it('refuses everything on a zero limit rather than treating it as unlimited', async () => {
    mockQueryRaw.mockResolvedValue([])
    const quota = await quotaWith({ incomingEmailsPerPeriod: 0, overQuotaBehavior: 'drop' })

    const result = await quota.consume('org-1', 'emails.processed', 1)

    expect(result.allowed).toBe(false)
    expect(result.limit).toBe(0)
  })
})

describe('PostgresQuota.refund', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecuteRaw.mockResolvedValue(1)
  })

  it('gives a consumed unit back', async () => {
    const quota = await quotaWith({ incomingEmailsPerPeriod: 1000 })

    await quota.refund('org-1', 'emails.processed', 1)

    expect(mockExecuteRaw).toHaveBeenCalled()
  })
})

/**
 * Every quota method used to resolve the plan itself, so a caller that had
 * already resolved one paid for a second lookup — `withApiKey` did two per
 * request, and `/api/app/usage` did eight. Passing the resolved plan through
 * removes the duplicate without introducing a cache.
 */
describe('reusing an already-resolved plan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQueryRaw.mockResolvedValue([{ value: 1 }])
    mockExecuteRaw.mockResolvedValue(1)
  })

  function countingResolver(overrides: Partial<typeof UNLIMITED> = {}) {
    const resolve = vi.fn().mockResolvedValue({
      planCode: 'free',
      planName: 'Free',
      limits: { ...UNLIMITED, ...overrides },
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    })
    return { resolve } as unknown as IPlanResolver & { resolve: ReturnType<typeof vi.fn> }
  }

  it('does not resolve again when consume is given a plan', async () => {
    const resolver = countingResolver({ incomingEmailsPerPeriod: 1000 })
    const { PostgresQuota } = await import('../quota')
    const quota = new PostgresQuota(resolver)
    const plan = await resolver.resolve('org-1')
    resolver.resolve.mockClear()

    await quota.consume('org-1', 'emails.processed', 1, plan)

    expect(resolver.resolve).not.toHaveBeenCalled()
  })

  it('still resolves when no plan is supplied', async () => {
    const resolver = countingResolver()
    const { PostgresQuota } = await import('../quota')
    const quota = new PostgresQuota(resolver)

    await quota.consume('org-1', 'emails.processed', 1)

    expect(resolver.resolve).toHaveBeenCalledTimes(1)
  })

  it('honours the supplied plan rather than re-reading it', async () => {
    const resolver = countingResolver({ incomingEmailsPerPeriod: null })
    const { PostgresQuota } = await import('../quota')
    const quota = new PostgresQuota(resolver)

    const result = await quota.consume('org-1', 'emails.processed', 1, {
      planCode: 'pro',
      planName: 'Pro',
      limits: { ...UNLIMITED, incomingEmailsPerPeriod: 5000 },
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    })

    expect(result.limit).toBe(5000)
  })
})

/**
 * `/api/app/usage` reports seven metrics. One statement rather than seven
 * matters because the banner polls.
 */
describe('PostgresQuota.peekMany', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads every metric in a single query', async () => {
    mockQueryRaw.mockResolvedValue([
      { metric: 'emails.processed', value: 250 },
      { metric: 'emails.dropped', value: 12 },
    ])
    const quota = await quotaWith({ incomingEmailsPerPeriod: 1000 })

    await quota.peekMany('org-1', ['emails.processed', 'emails.dropped', 'emails.sent'])

    expect(mockQueryRaw).toHaveBeenCalledTimes(1)
  })

  it('returns a result for every requested metric, including ones with no row', async () => {
    mockQueryRaw.mockResolvedValue([{ metric: 'emails.processed', value: 250 }])
    const quota = await quotaWith({ incomingEmailsPerPeriod: 1000 })

    const results = await quota.peekMany('org-1', ['emails.processed', 'emails.sent'])

    expect(results.get('emails.processed')?.used).toBe(250)
    // Never counted this period — zero, not absent.
    expect(results.get('emails.sent')?.used).toBe(0)
  })

  it('carries each metric its own limit', async () => {
    mockQueryRaw.mockResolvedValue([])
    const quota = await quotaWith({ incomingEmailsPerPeriod: 1000, outboundEmailsPerPeriod: 50 })

    const results = await quota.peekMany('org-1', ['emails.processed', 'emails.sent', 'emails.dropped'])

    expect(results.get('emails.processed')?.limit).toBe(1000)
    expect(results.get('emails.sent')?.limit).toBe(50)
    // Report-only: no limit key, so unlimited.
    expect(results.get('emails.dropped')?.limit).toBeNull()
  })

  it('resolves the plan once for the whole batch', async () => {
    mockQueryRaw.mockResolvedValue([])
    const resolver = {
      resolve: vi.fn().mockResolvedValue({
        planCode: 'free',
        planName: 'Free',
        limits: UNLIMITED,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      }),
    }
    const { PostgresQuota } = await import('../quota')
    const quota = new PostgresQuota(resolver as unknown as IPlanResolver)

    await quota.peekMany('org-1', ['emails.processed', 'emails.sent', 'api.requests'])

    expect(resolver.resolve).toHaveBeenCalledTimes(1)
  })
})

describe('PostgresQuota.peek', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports usage without consuming', async () => {
    mockQueryRaw.mockResolvedValue([{ value: 250 }])
    const quota = await quotaWith({ incomingEmailsPerPeriod: 1000 })

    const result = await quota.peek('org-1', 'emails.processed')

    expect(result.used).toBe(250)
    expect(result.limit).toBe(1000)
    expect(result.allowed).toBe(true)
    expect(mockExecuteRaw).not.toHaveBeenCalled()
  })

  it('reports zero usage when no counter row exists yet', async () => {
    mockQueryRaw.mockResolvedValue([])
    const quota = await quotaWith({ incomingEmailsPerPeriod: 1000 })

    const result = await quota.peek('org-1', 'emails.processed')

    expect(result.used).toBe(0)
    expect(result.allowed).toBe(true)
  })

  it('reports not-allowed once usage has reached the limit', async () => {
    mockQueryRaw.mockResolvedValue([{ value: 1000 }])
    const quota = await quotaWith({ incomingEmailsPerPeriod: 1000 })

    expect((await quota.peek('org-1', 'emails.processed')).allowed).toBe(false)
  })
})
