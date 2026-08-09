import { prisma } from '@/lib/db'
import type {
  IPlanResolver,
  IQuota,
  QuotaMetric,
  QuotaResult,
} from '@/lib/commercial/interfaces'
import type { PlanLimits } from '@/lib/commercial/plan-limits'

/**
 * Which plan limit governs each metric.
 *
 * `emails.dropped` is deliberately absent: it is report-only, incremented so
 * the dashboard can say how much inbound mail was discarded past the cap.
 * Giving it a limit would mean refusing to record a drop, which defeats the
 * counter.
 */
const LIMIT_KEY: Partial<Record<QuotaMetric, keyof PlanLimits>> = {
  'emails.processed': 'incomingEmailsPerPeriod',
  'emails.sent': 'outboundEmailsPerPeriod',
  'llm.enrichments': 'llmEnrichmentsPerPeriod',
  'automation.runs': 'automationRunsPerPeriod',
  'webhook.deliveries': 'webhookDeliveriesPerPeriod',
  'api.requests': 'apiRequestsPerPeriod',
}

function limitFor(limits: PlanLimits, metric: QuotaMetric): number | null {
  const key = LIMIT_KEY[metric]
  if (!key) return null
  const value = limits[key]
  return typeof value === 'number' ? value : null
}

/**
 * Durable, atomic usage accounting in Postgres (issue #117 §5).
 *
 * Postgres rather than Redis, deliberately: a dropped rate-limiter counter
 * costs one extra request, a dropped quota counter is a billing error. The
 * inbound path is already writing to Postgres, so this adds no new dependency
 * to the hot path.
 *
 * **Check and consume are one statement.** A read followed by a write lets two
 * concurrent inbound messages both observe 999 of 1000 and both proceed. The
 * guard therefore lives inside the statement, and "denied" is expressed as *no
 * row returned* — so refusing and not-consuming are the same fact rather than
 * two steps that can disagree.
 */
export class PostgresQuota implements IQuota {
  constructor(private readonly plans: IPlanResolver) {}

  async consume(
    organizationId: string,
    metric: QuotaMetric,
    quantity: number,
  ): Promise<QuotaResult> {
    const plan = await this.plans.resolve(organizationId)
    const limit = limitFor(plan.limits, metric)
    const { periodStart, periodEnd } = this.period(plan)

    // Unlimited, report-only, or a plan that bills overage rather than
    // refusing: consume unconditionally and never deny.
    const unguarded = limit === null || plan.limits.overQuotaBehavior === 'overage'

    const rows = unguarded
      ? await this.upsertUnguarded(organizationId, metric, periodStart, periodEnd, quantity)
      : await this.upsertGuarded(organizationId, metric, periodStart, periodEnd, quantity, limit)

    if (rows.length === 0) {
      // The guard failed. Nothing was written, so usage is still at the limit.
      return { allowed: false, limit, used: limit ?? 0, resetsAt: periodEnd }
    }

    return { allowed: true, limit, used: rows[0].value, resetsAt: periodEnd }
  }

  async refund(organizationId: string, metric: QuotaMetric, quantity: number): Promise<void> {
    const plan = await this.plans.resolve(organizationId)
    const { periodStart } = this.period(plan)

    // `GREATEST(..., 0)` because a refund must never drive a counter negative:
    // a refund for a period that has already rolled over would otherwise leave
    // the new period starting below zero and silently widen the allowance.
    await prisma.$executeRaw`
      UPDATE "usage_counters"
         SET "value" = GREATEST("value" - ${quantity}, 0), "updatedAt" = NOW()
       WHERE "organizationId" = ${organizationId}::uuid
         AND "metric" = ${metric}
         AND "periodStart" = ${periodStart}
    `
  }

  async peek(organizationId: string, metric: QuotaMetric): Promise<QuotaResult> {
    const plan = await this.plans.resolve(organizationId)
    const limit = limitFor(plan.limits, metric)
    const { periodStart, periodEnd } = this.period(plan)

    const rows = await prisma.$queryRaw<{ value: number }[]>`
      SELECT "value" FROM "usage_counters"
       WHERE "organizationId" = ${organizationId}::uuid
         AND "metric" = ${metric}
         AND "periodStart" = ${periodStart}
    `

    const used = rows[0]?.value ?? 0
    return { allowed: limit === null || used < limit, limit, used, resetsAt: periodEnd }
  }

  async increment(
    organizationId: string,
    metric: QuotaMetric,
    quantity: number,
  ): Promise<void> {
    const plan = await this.plans.resolve(organizationId)
    const { periodStart, periodEnd } = this.period(plan)
    await this.upsertUnguarded(organizationId, metric, periodStart, periodEnd, quantity)
  }

  /**
   * A resolved plan always has a period once `USE_COMMERCIAL` is on — the
   * resolver falls back to the calendar month. The nulls are only reachable via
   * the OSS resolver, which is never paired with this class.
   */
  private period(plan: { periodStart: Date | null; periodEnd: Date | null }) {
    if (!plan.periodStart || !plan.periodEnd) {
      throw new Error('PostgresQuota requires a resolved billing period')
    }
    return { periodStart: plan.periodStart, periodEnd: plan.periodEnd }
  }

  private upsertUnguarded(
    organizationId: string,
    metric: string,
    periodStart: Date,
    periodEnd: Date,
    quantity: number,
  ) {
    return prisma.$queryRaw<{ value: number }[]>`
      INSERT INTO "usage_counters"
        ("id", "organizationId", "metric", "periodStart", "periodEnd", "value", "updatedAt")
      VALUES
        (gen_random_uuid(), ${organizationId}::uuid, ${metric}, ${periodStart}, ${periodEnd}, ${quantity}, NOW())
      ON CONFLICT ("organizationId", "metric", "periodStart")
      DO UPDATE SET "value" = "usage_counters"."value" + ${quantity}, "updatedAt" = NOW()
      RETURNING "value"
    `
  }

  /**
   * The guarded form.
   *
   * Both paths need the guard, which is the subtle part. `ON CONFLICT ... DO
   * UPDATE ... WHERE` constrains only the *update*; on a first consume in a new
   * period there is no conflict, so an unguarded `VALUES` would insert a row
   * exceeding the limit in one shot. Writing the insert as `SELECT ... WHERE`
   * applies the same bound to the create path, so a single oversized consume is
   * refused rather than granted.
   *
   * Returns no row when either guard fails — that absence *is* the denial.
   */
  private upsertGuarded(
    organizationId: string,
    metric: string,
    periodStart: Date,
    periodEnd: Date,
    quantity: number,
    limit: number,
  ) {
    return prisma.$queryRaw<{ value: number }[]>`
      INSERT INTO "usage_counters"
        ("id", "organizationId", "metric", "periodStart", "periodEnd", "value", "updatedAt")
      SELECT gen_random_uuid(), ${organizationId}::uuid, ${metric}, ${periodStart}, ${periodEnd}, ${quantity}, NOW()
       WHERE ${quantity} <= ${limit}
      ON CONFLICT ("organizationId", "metric", "periodStart")
      DO UPDATE SET "value" = "usage_counters"."value" + ${quantity}, "updatedAt" = NOW()
       WHERE "usage_counters"."value" + ${quantity} <= ${limit}
      RETURNING "value"
    `
  }
}
