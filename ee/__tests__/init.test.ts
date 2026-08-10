import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withConfigEnv, setConfigEnv } from '@/test/config'

const planFindManyMock = vi.fn()
const loggerWarnMock = vi.fn()
const loggerInfoMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: { plan: { findMany: (...a: unknown[]) => planFindManyMock(...a) } },
}))

vi.mock('@/lib/logger', () => ({
  default: { warn: (...a: unknown[]) => loggerWarnMock(...a), info: (...a: unknown[]) => loggerInfoMock(...a), error: vi.fn() },
}))

/** Lets a fire-and-forget promise settle before assertions. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('initializeCommercialPlans', () => {
  withConfigEnv({
    USE_COMMERCIAL: 'true',
    STRIPE_SECRET_KEY: 'sk_test_abcdefghijklmnopqrstuvwx',
    STRIPE_WEBHOOK_SECRET: 'whsec_abcdefghijklmnopqrstuvwx',
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    planFindManyMock.mockResolvedValue([])
  })

  afterEach(async () => {
    const { CommercialProvider } = await import('@/lib/commercial/provider')
    CommercialProvider.reset()
  })

  /**
   * The failure this exists to surface: a deployment where the commercial layer
   * is on but nobody set `Plan.stripePriceId`. Checkout returns 503, and
   * without this warning that is discovered when a customer tries to pay.
   */
  it('warns when a purchasable plan has no Stripe price', async () => {
    planFindManyMock.mockResolvedValue([{ code: 'pro', name: 'Pro' }])
    const { initializeCommercialPlans } = await import('../init')

    initializeCommercialPlans()
    await flush()

    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({ planCodes: ['pro'] }),
      expect.stringMatching(/stripePriceId|cannot be purchased/i),
    )
  })

  it('says nothing when every purchasable plan is priced', async () => {
    planFindManyMock.mockResolvedValue([])
    const { initializeCommercialPlans } = await import('../init')

    initializeCommercialPlans()
    await flush()

    expect(loggerWarnMock).not.toHaveBeenCalled()
  })

  /**
   * `free` is public and deliberately has no price — nobody checks out for the
   * plan they fall back to. Warning about it would be noise on every boot,
   * which is how a warning stops being read.
   */
  it('excludes the default plan, which is public and unpriced by design', async () => {
    const { initializeCommercialPlans } = await import('../init')

    initializeCommercialPlans()
    await flush()

    expect(planFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isPublic: true,
          stripePriceId: null,
          code: { not: 'free' },
        }),
      }),
    )
  })

  /**
   * A diagnostic query must not be able to take the process down. Boot has
   * already wired enforcement by this point; a database that is not ready yet
   * is a normal startup race, not a reason to crash.
   */
  it('survives the diagnostic query failing', async () => {
    planFindManyMock.mockRejectedValue(new Error('database not ready'))
    const { initializeCommercialPlans } = await import('../init')

    expect(() => initializeCommercialPlans()).not.toThrow()
    await flush()
  })

  it('still installs the plan engine when the diagnostic fails', async () => {
    planFindManyMock.mockRejectedValue(new Error('database not ready'))
    const { initializeCommercialPlans } = await import('../init')
    const { CommercialProvider } = await import('@/lib/commercial/provider')

    initializeCommercialPlans()
    await flush()

    const { DbPlanResolver } = await import('../plans/resolver')
    expect(CommercialProvider.plans).toBeInstanceOf(DbPlanResolver)
  })

  /**
   * The whole point of the flag: a self-hosted deployment must not query the
   * plan tables at all, including for diagnostics.
   */
  it('runs no query at all when the commercial layer is off', async () => {
    setConfigEnv({ USE_COMMERCIAL: 'false' })
    const { initializeCommercialPlans } = await import('../init')

    initializeCommercialPlans()
    await flush()

    expect(planFindManyMock).not.toHaveBeenCalled()
    expect(loggerWarnMock).not.toHaveBeenCalled()
  })
})
