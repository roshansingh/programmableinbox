/**
 * Billing period boundaries (issue #117 §4).
 *
 * A period is a half-open interval `[periodStart, periodEnd)`, and it is the
 * third component of the `usage_counters` unique key — so these functions
 * decide when an organization's allowance resets.
 *
 * Everything is computed in UTC. `Date.getMonth()` and friends read the host's
 * timezone, which would shift every reset by the host offset and put an
 * instant like `2026-08-01T00:30:00Z` in July anywhere west of Greenwich. This
 * repo has already been bitten once by a non-UTC session timezone silently
 * corrupting a timestamp comparison (see CLAUDE.md on grouped-thread cursor
 * pagination), so UTC here is deliberate rather than incidental.
 */

export type Period = { periodStart: Date; periodEnd: Date }

/** The UTC calendar month containing `now`. */
export function calendarMonthPeriod(now: Date): Period {
  const periodStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  )
  // Month 12 rolls the year over, which Date.UTC handles.
  const periodEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  )
  return { periodStart, periodEnd }
}

type SubscriptionPeriod = {
  currentPeriodStart: Date
  currentPeriodEnd: Date
}

/**
 * The period an organization's counters are keyed by.
 *
 * A paid subscription supplies its own anniversary window, which is what keeps
 * usage aligned with what the customer is invoiced for once billing exists.
 * Everything else falls back to the calendar month:
 *
 * - **No subscription row** — an organization resolves to `free`, which has no
 *   anniversary. This is also what lets `USE_COMMERCIAL` be switched on
 *   without first backfilling a subscription for every existing organization.
 *
 * - **An expired subscription window** — if a renewal was never recorded (a
 *   provider webhook that never arrived, say), continuing to use the stale
 *   window would freeze the counter key and let the organization spend last
 *   period's allowance indefinitely. Falling back keeps enforcement live and
 *   fails toward *counting*, which is the safe direction.
 */
export function periodFor(subscription: SubscriptionPeriod | null, now: Date): Period {
  if (subscription && subscription.currentPeriodEnd > now) {
    return {
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
    }
  }
  return calendarMonthPeriod(now)
}
