import { describe, it, expect } from 'vitest'
import { UnlimitedPlanResolver } from '../oss/UnlimitedPlanResolver'
import { NoopQuota } from '../oss/NoopQuota'
import { NoopMetering } from '../oss/NoopMetering'
import { SELF_HOSTED_PLAN_CODE } from '../interfaces'
import { UNLIMITED } from '../plan-limits'

/**
 * The OSS defaults are what the whole open-source build runs on: with `ee/`
 * deleted these are the only implementations that exist, so "unlimited" has to
 * be their behaviour rather than an accident of nothing calling them.
 */
describe('UnlimitedPlanResolver', () => {
  const resolver = new UnlimitedPlanResolver()

  it('resolves every organization to the self-hosted plan', async () => {
    const plan = await resolver.resolve('any-org-id')

    expect(plan.planCode).toBe(SELF_HOSTED_PLAN_CODE)
    expect(plan.limits).toEqual(UNLIMITED)
  })

  it('exposes no billing period, since nothing is metered', async () => {
    const plan = await resolver.resolve('any-org-id')

    expect(plan.periodStart).toBeNull()
    expect(plan.periodEnd).toBeNull()
  })

  /**
   * Never carries the numeric Plan.id — nothing downstream may start depending
   * on a surrogate key whose value is assigned by a sequence (issue #117 §4).
   */
  it('does not expose a numeric plan id', async () => {
    const plan = await resolver.resolve('any-org-id')

    expect(plan).not.toHaveProperty('planId')
    expect(plan).not.toHaveProperty('id')
  })
})

describe('NoopQuota', () => {
  const quota = new NoopQuota()

  it('allows every consume', async () => {
    const result = await quota.consume('org', 'emails.processed', 1)

    expect(result.allowed).toBe(true)
  })

  it('reports an unlimited limit and no reset, so the UI renders no cap', async () => {
    const result = await quota.consume('org', 'emails.processed', 1)

    expect(result.limit).toBeNull()
    expect(result.resetsAt).toBeNull()
  })

  it('allows consumption far beyond any plausible plan limit', async () => {
    const result = await quota.consume('org', 'emails.processed', 10_000_000)

    expect(result.allowed).toBe(true)
  })

  it('peeks as allowed without recording anything', async () => {
    const result = await quota.peek('org', 'emails.processed')

    expect(result.allowed).toBe(true)
    expect(result.used).toBe(0)
  })

  it('accepts refund and increment without throwing', async () => {
    await expect(quota.refund('org', 'emails.processed', 1)).resolves.toBeUndefined()
    await expect(quota.increment('org', 'emails.dropped', 1)).resolves.toBeUndefined()
  })
})

describe('NoopMetering', () => {
  it('discards records without throwing', async () => {
    const metering = new NoopMetering()

    await expect(
      metering.record({ organizationId: 'org', metric: 'emails.processed', quantity: 1 }),
    ).resolves.toBeUndefined()
  })
})
