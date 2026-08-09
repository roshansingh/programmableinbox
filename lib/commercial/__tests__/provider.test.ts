import { describe, it, expect, afterEach } from 'vitest'
import { CommercialProvider } from '../provider'
import { UnlimitedPlanResolver } from '../oss/UnlimitedPlanResolver'
import { NoopQuota } from '../oss/NoopQuota'
import { NoopMetering } from '../oss/NoopMetering'
import { SELF_HOSTED_PLAN_CODE, type IPlanResolver, type IQuota, type IMetering } from '../interfaces'
import { UNLIMITED } from '../plan-limits'

describe('CommercialProvider', () => {
  afterEach(() => {
    CommercialProvider.reset()
  })

  describe('OSS defaults', () => {
    it('lazily provides the unlimited plan resolver', () => {
      expect(CommercialProvider.plans).toBeInstanceOf(UnlimitedPlanResolver)
    })

    it('lazily provides the no-op quota', () => {
      expect(CommercialProvider.quota).toBeInstanceOf(NoopQuota)
    })

    it('lazily provides the no-op metering', () => {
      expect(CommercialProvider.metering).toBeInstanceOf(NoopMetering)
    })

    it('memoises, so repeated access returns one instance', () => {
      expect(CommercialProvider.plans).toBe(CommercialProvider.plans)
      expect(CommercialProvider.quota).toBe(CommercialProvider.quota)
    })

    /**
     * The property the whole open-source build rests on: with `ee/` absent
     * nothing calls `configure()`, so every enforcement call site must see an
     * unlimited plan and an allowing quota rather than throwing or refusing.
     */
    it('enforces nothing at all when never configured', async () => {
      const plan = await CommercialProvider.plans.resolve('org-1')
      const quota = await CommercialProvider.quota.consume('org-1', 'emails.processed', 1)

      expect(plan.planCode).toBe(SELF_HOSTED_PLAN_CODE)
      expect(plan.limits).toEqual(UNLIMITED)
      expect(quota.allowed).toBe(true)
      expect(quota.limit).toBeNull()
    })
  })

  describe('configure()', () => {
    const strictPlans: IPlanResolver = {
      resolve: async () => ({
        planCode: 'free',
        planName: 'Free',
        limits: { ...UNLIMITED, emailInboxes: 1, incomingEmailsPerPeriod: 1000 },
        periodStart: new Date('2026-08-01T00:00:00Z'),
        periodEnd: new Date('2026-09-01T00:00:00Z'),
      }),
    }
    const strictQuota: IQuota = {
      consume: async () => ({
        allowed: false,
        limit: 1000,
        used: 1000,
        resetsAt: new Date('2026-09-01T00:00:00Z'),
      }),
      refund: async () => {},
      peek: async () => ({ allowed: false, limit: 1000, used: 1000, resetsAt: null }),
      increment: async () => {},
    }
    const noopMetering: IMetering = { record: async () => {} }

    it('installs all three implementations at once', () => {
      CommercialProvider.configure(strictPlans, strictQuota, noopMetering)

      expect(CommercialProvider.plans).toBe(strictPlans)
      expect(CommercialProvider.quota).toBe(strictQuota)
      expect(CommercialProvider.metering).toBe(noopMetering)
    })

    it('makes the configured plan and quota authoritative for call sites', async () => {
      CommercialProvider.configure(strictPlans, strictQuota, noopMetering)

      const plan = await CommercialProvider.plans.resolve('org-1')
      const quota = await CommercialProvider.quota.consume('org-1', 'emails.processed', 1)

      expect(plan.limits.emailInboxes).toBe(1)
      expect(quota.allowed).toBe(false)
      // The fields the old PolicyCheckResult could not carry, and which a 402
      // body and the usage dashboard both need.
      expect(quota.limit).toBe(1000)
      expect(quota.used).toBe(1000)
      expect(quota.resetsAt).toEqual(new Date('2026-09-01T00:00:00Z'))
    })

    it('overrides a previously configured set', () => {
      CommercialProvider.configure(strictPlans, strictQuota, noopMetering)
      const otherQuota: IQuota = { ...strictQuota }
      CommercialProvider.configure(strictPlans, otherQuota, noopMetering)

      expect(CommercialProvider.quota).toBe(otherQuota)
    })
  })

  describe('reset()', () => {
    it('restores the OSS defaults, so one suite cannot leak enforcement into the next', async () => {
      CommercialProvider.configure(
        { resolve: async () => ({ planCode: 'free', planName: 'Free', limits: UNLIMITED, periodStart: null, periodEnd: null }) },
        {
          consume: async () => ({ allowed: false, limit: 0, used: 0, resetsAt: null }),
          refund: async () => {},
          peek: async () => ({ allowed: false, limit: 0, used: 0, resetsAt: null }),
          increment: async () => {},
        },
        { record: async () => {} },
      )

      CommercialProvider.reset()

      expect(CommercialProvider.plans).toBeInstanceOf(UnlimitedPlanResolver)
      expect((await CommercialProvider.quota.consume('org-1', 'emails.processed', 1)).allowed).toBe(true)
    })
  })
})
