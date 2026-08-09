import { describe, it, expect } from 'vitest'
import { calendarMonthPeriod, periodFor } from '../period'

/**
 * Period boundaries decide when a counter resets, so an off-by-one here hands
 * an organization a second allowance or withholds one they have paid for.
 *
 * Everything is UTC. CLAUDE.md documents that a non-UTC session timezone
 * already silently broke cursor pagination once; a month boundary computed in
 * local time would shift every reset by the host's offset.
 */
describe('calendarMonthPeriod', () => {
  it('starts at the first instant of the month, UTC', () => {
    const { periodStart } = calendarMonthPeriod(new Date('2026-08-08T09:30:00.000Z'))

    expect(periodStart.toISOString()).toBe('2026-08-01T00:00:00.000Z')
  })

  it('ends at the first instant of the next month, so periods tile without gaps', () => {
    const { periodEnd } = calendarMonthPeriod(new Date('2026-08-08T09:30:00.000Z'))

    expect(periodEnd.toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })

  it('rolls over the year boundary', () => {
    const { periodStart, periodEnd } = calendarMonthPeriod(new Date('2026-12-31T23:59:59.999Z'))

    expect(periodStart.toISOString()).toBe('2026-12-01T00:00:00.000Z')
    expect(periodEnd.toISOString()).toBe('2027-01-01T00:00:00.000Z')
  })

  it('handles February in a leap year', () => {
    const { periodStart, periodEnd } = calendarMonthPeriod(new Date('2028-02-29T12:00:00.000Z'))

    expect(periodStart.toISOString()).toBe('2028-02-01T00:00:00.000Z')
    expect(periodEnd.toISOString()).toBe('2028-03-01T00:00:00.000Z')
  })

  it('puts the very first instant of a month in that month, not the previous one', () => {
    const { periodStart } = calendarMonthPeriod(new Date('2026-08-01T00:00:00.000Z'))

    expect(periodStart.toISOString()).toBe('2026-08-01T00:00:00.000Z')
  })

  /**
   * A local-time implementation would return July for this instant anywhere
   * west of UTC, which is exactly the class of bug that broke grouped-thread
   * pagination.
   */
  it('is unaffected by the host timezone', () => {
    const justAfterMidnightUtc = new Date('2026-08-01T00:30:00.000Z')

    expect(calendarMonthPeriod(justAfterMidnightUtc).periodStart.toISOString()).toBe(
      '2026-08-01T00:00:00.000Z',
    )
  })
})

describe('periodFor', () => {
  const now = new Date('2026-08-08T09:30:00.000Z')

  it('uses the subscription period when one is present', () => {
    const subscription = {
      currentPeriodStart: new Date('2026-07-15T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-08-15T00:00:00.000Z'),
    }

    expect(periodFor(subscription, now)).toEqual({
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
    })
  })

  /**
   * An organization with no Subscription row resolves to `free`, and free has
   * no billing anniversary — so it falls back to the calendar month. This is
   * what lets USE_COMMERCIAL be switched on without backfilling a subscription
   * for every existing organization first.
   */
  it('falls back to the calendar month when there is no subscription', () => {
    expect(periodFor(null, now)).toEqual(calendarMonthPeriod(now))
  })

  /**
   * A stale subscription period would freeze the counter key, so an
   * organization whose renewal webhook never arrived would keep consuming last
   * period's allowance forever. Falling back keeps enforcement live.
   */
  it('falls back to the calendar month when the subscription period has already ended', () => {
    const expired = {
      currentPeriodStart: new Date('2026-06-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
    }

    expect(periodFor(expired, now)).toEqual(calendarMonthPeriod(now))
  })
})
