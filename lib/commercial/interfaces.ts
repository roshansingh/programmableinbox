import type { PlanLimits } from './plan-limits'

/**
 * The seam between the open-source core and the commercial plan engine
 * (issue #117 §3).
 *
 * Everything here is OSS and stays OSS: the *call sites* that enforce plans
 * live in the open tree, only the implementations behind `CommercialProvider`
 * move to `ee/`. That is what makes the stripped build exercise the same code
 * path the hosted one does, rather than a second, untested branch.
 *
 * This replaces the earlier `IPolicy`/`IEntitlements` pair, which could not
 * back an enforced quota:
 *
 * - `PolicyCheckResult` was `{ allowed, reason }` with no `limit`/`used`/
 *   `resetsAt`, so a 402 could not say what the cap was or when it clears, and
 *   the dashboard could not render "980 / 1000".
 * - `IMetering` is documented fire-and-forget and is *allowed* to drop writes.
 *   A meter that may lose a write cannot be the thing that rejects the 1,001st
 *   email. Enforcement therefore needs its own durable, atomic counter, which
 *   is `IQuota`. Metering stays fire-and-forget for billing telemetry.
 */

/** The plan every organization gets when `USE_COMMERCIAL=false`. */
export const SELF_HOSTED_PLAN_CODE = 'self_hosted'

/**
 * Metrics with a per-period allowance.
 *
 * `emails.dropped` is deliberately in the same namespace even though nothing
 * enforces against it: it is incremented unconditionally so the dashboard can
 * report how much inbound mail was discarded past the cap. Without it, a `drop`
 * plan can only say "you are at your limit" and never "and 247 messages were
 * lost", which is the number that actually motivates an upgrade.
 */
export type QuotaMetric =
  | 'emails.processed'
  | 'emails.dropped'
  | 'emails.sent'
  | 'llm.enrichments'
  | 'automation.runs'
  | 'webhook.deliveries'
  | 'api.requests'

export interface QuotaResult {
  allowed: boolean
  /** `null` is unlimited. Zero is a real limit meaning "none allowed". */
  limit: number | null
  used: number
  /** End of the current period, or `null` when there is no period. */
  resetsAt: Date | null
}

/**
 * A plan resolved for one organization, at one moment.
 *
 * Carries `planCode`, never the numeric `Plan.id`. The id is a surrogate whose
 * value is assigned by a sequence and is not contractual; keeping it out of
 * this type is what stops call sites quietly starting to depend on it.
 */
export interface ResolvedPlan {
  planCode: string
  planName: string
  limits: PlanLimits
  periodStart: Date | null
  periodEnd: Date | null
}

export interface IPlanResolver {
  resolve(organizationId: string): Promise<ResolvedPlan>
}

/**
 * Durable, atomic usage accounting. Unlike `IMetering`, this may not lose a
 * write — it is what enforcement reads and decrements.
 */
export interface IQuota {
  /**
   * Atomic check-and-consume. Returns `allowed: false` **without consuming**
   * when the metric is exhausted and the plan's `overQuotaBehavior` is `drop`.
   *
   * Must be a single statement against the store. A separate read-then-write
   * lets concurrent inbound mail overshoot the cap.
   */
  consume(organizationId: string, metric: QuotaMetric, quantity: number): Promise<QuotaResult>

  /**
   * Return a consumed unit when the work turned out to be a no-op — chiefly a
   * duplicate webhook delivery, where the message was already stored and the
   * insert hit the `(externalId, inboxEmailAddressId)` unique constraint.
   * Without this, a provider's retries burn the organization's allowance.
   */
  refund(organizationId: string, metric: QuotaMetric, quantity: number): Promise<void>

  /** Read without consuming — for the usage endpoint and pre-flight checks. */
  peek(organizationId: string, metric: QuotaMetric): Promise<QuotaResult>

  /** Unconditional increment, for report-only counters such as `emails.dropped`. */
  increment(organizationId: string, metric: QuotaMetric, quantity: number): Promise<void>
}

export interface MeteringRequest {
  organizationId: string
  metric: QuotaMetric | string
  quantity: number
  timestamp?: Date
}

/**
 * Fire-and-forget usage telemetry. Never blocks a request and is permitted to
 * drop writes, which is exactly why it cannot be the basis for enforcement.
 */
export interface IMetering {
  record(request: MeteringRequest): Promise<void>
}
