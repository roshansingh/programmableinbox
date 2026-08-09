import { CommercialProvider } from './provider'
import { isAtLimit, type PlanLimits } from './plan-limits'

/**
 * The limit keys that cap a *count of rows*, as opposed to a per-period meter
 * or a feature toggle. Derived from `PlanLimits` rather than listed by hand, so
 * a new numeric limit is usable here the moment it exists and a boolean one can
 * never be passed by mistake.
 */
export type CountLimitKey = {
  [K in keyof PlanLimits]: PlanLimits[K] extends number | null ? K : never
}[keyof PlanLimits]

/**
 * A refused create. `402 Payment Required` rather than 403 or 429: this
 * codebase already uses 403 for organization authorization and the email
 * verification gate, and 429 for rate limiting, and "upgrade your plan" is a
 * different remedy from either "you lack permission" or "wait a minute".
 *
 * Carries `limit`, `used` and `planCode` so the client can render an accurate
 * upsell rather than a bare message.
 */
export type PlanDenial = {
  message: string
  status: 402
  limit: number
  used: number
  planCode: string
}

/**
 * Enforces a count cap at a create path (issue #117 §6c).
 *
 * Three properties are deliberate:
 *
 * - **`count` is a callback, and it is only invoked when a limit exists.** An
 *   unlimited plan — every self-hosted deployment — must not pay for a COUNT
 *   against a table it will never restrict.
 *
 * - **Caps gate creation only.** This is a create-time predicate, never a
 *   reconciler: an organization already over its limit when `USE_COMMERCIAL`
 *   is switched on keeps every existing resource working and visible, and only
 *   the next create is refused.
 *
 * - **It is advisory against concurrency.** Two simultaneous creates can both
 *   observe the same count and both proceed, yielding one resource over the
 *   cap. Accepted (issue #117 §6c): the window is milliseconds, the harm is a
 *   single extra row, and a serializable transaction or an advisory lock on
 *   every create costs more than the defect. The per-period meters do *not*
 *   share this weakness — `IQuota.consume` is atomic.
 */
export async function checkResourceLimit(
  organizationId: string,
  limitKey: CountLimitKey,
  resourceLabel: string,
  count: () => Promise<number>,
): Promise<PlanDenial | null> {
  const plan = await CommercialProvider.plans.resolve(organizationId)
  const limit = plan.limits[limitKey] as number | null

  if (limit === null) return null

  const used = await count()
  if (!isAtLimit(limit, used)) return null

  const noun = limit === 1 ? resourceLabel : pluralise(resourceLabel)
  return {
    message: `Your ${plan.planName} plan allows ${limit} ${noun}. Upgrade to add more.`,
    status: 402,
    limit,
    used,
    planCode: plan.planCode,
  }
}

/** Enough for the resource nouns in use; not a general pluraliser. */
function pluralise(label: string): string {
  if (/(s|x|z|ch|sh)$/.test(label)) return `${label}es`
  if (/[^aeiou]y$/.test(label)) return `${label.slice(0, -1)}ies`
  return `${label}s`
}
