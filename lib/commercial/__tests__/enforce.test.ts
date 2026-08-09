import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CommercialProvider } from '../provider'
import { checkResourceLimit } from '../enforce'
import { UNLIMITED, type PlanLimits } from '../plan-limits'

function configurePlan(planCode: string, planName: string, overrides: Partial<PlanLimits>) {
  CommercialProvider.configure(
    {
      resolve: async () => ({
        planCode,
        planName,
        limits: { ...UNLIMITED, ...overrides },
        periodStart: null,
        periodEnd: null,
      }),
    },
    CommercialProvider.quota,
    CommercialProvider.metering,
  )
}

describe('checkResourceLimit', () => {
  const count = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    count.mockResolvedValue(0)
  })

  afterEach(() => {
    CommercialProvider.reset()
  })

  it('allows when the limit is unlimited', async () => {
    configurePlan('self_hosted', 'Self-hosted', { emailInboxes: null })

    expect(await checkResourceLimit('org-1', 'emailInboxes', 'email inbox', count)).toBeNull()
  })

  /**
   * The self-hosted hot path: an unlimited plan must not pay for a COUNT
   * against a table it will never restrict.
   */
  it('does not run the count query when the limit is unlimited', async () => {
    configurePlan('self_hosted', 'Self-hosted', { emailInboxes: null })

    await checkResourceLimit('org-1', 'emailInboxes', 'email inbox', count)

    expect(count).not.toHaveBeenCalled()
  })

  it('allows while under the limit', async () => {
    configurePlan('pro', 'Pro', { emailInboxes: 2 })
    count.mockResolvedValue(1)

    expect(await checkResourceLimit('org-1', 'emailInboxes', 'email inbox', count)).toBeNull()
  })

  it('denies at the limit, reporting the cap, the usage and the plan', async () => {
    configurePlan('free', 'Free', { emailInboxes: 1 })
    count.mockResolvedValue(1)

    const denial = await checkResourceLimit('org-1', 'emailInboxes', 'email inbox', count)

    expect(denial).not.toBeNull()
    expect(denial!.status).toBe(402)
    expect(denial!.limit).toBe(1)
    expect(denial!.used).toBe(1)
    expect(denial!.planCode).toBe('free')
  })

  /**
   * Reachable the moment USE_COMMERCIAL is switched on: an organization that
   * already holds three inboxes lands on `free`, which allows one. The
   * existing rows are never touched — only the next create is refused.
   */
  it('denies when existing usage already exceeds the limit', async () => {
    configurePlan('free', 'Free', { emailInboxes: 1 })
    count.mockResolvedValue(3)

    const denial = await checkResourceLimit('org-1', 'emailInboxes', 'email inbox', count)

    expect(denial!.used).toBe(3)
    expect(denial!.limit).toBe(1)
  })

  /**
   * `null` and `0` are both falsy. A `!limit` guard would read "none allowed"
   * as "unlimited" and hand out exactly the resource the plan forbids.
   */
  it('denies everything on a zero limit rather than treating it as unlimited', async () => {
    configurePlan('free', 'Free', { phoneInboxes: 0 })
    count.mockResolvedValue(0)

    const denial = await checkResourceLimit('org-1', 'phoneInboxes', 'phone inbox', count)

    expect(denial).not.toBeNull()
    expect(denial!.limit).toBe(0)
  })

  it('names the plan and the resource so the message is actionable', async () => {
    configurePlan('free', 'Free', { emailInboxes: 1 })
    count.mockResolvedValue(1)

    const denial = await checkResourceLimit('org-1', 'emailInboxes', 'email inbox', count)

    expect(denial!.message).toContain('Free')
    expect(denial!.message).toContain('email inbox')
  })

  it('pluralises the resource when the limit is more than one', async () => {
    configurePlan('pro', 'Pro', { emailInboxes: 2 })
    count.mockResolvedValue(2)

    const denial = await checkResourceLimit('org-1', 'emailInboxes', 'email inbox', count)

    expect(denial!.message).toContain('2 email inboxes')
  })

  it('allows unconditionally under the OSS defaults, without counting', async () => {
    const result = await checkResourceLimit('org-1', 'emailInboxes', 'email inbox', count)

    expect(result).toBeNull()
    expect(count).not.toHaveBeenCalled()
  })
})
