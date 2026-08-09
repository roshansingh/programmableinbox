import { z } from 'zod'

/**
 * The shape of `Plan.limits` (issue #117 §4).
 *
 * `Plan.limits` is a Prisma `Json` column, so Prisma type-checks nothing about
 * its contents. **This schema is the entire contract** — it is parsed on read
 * and validated on write, in the same spirit as `lib/config/schema.ts`, which
 * is the one other place in this codebase where untyped external input becomes
 * typed internal config.
 *
 * Three properties are load-bearing:
 *
 * - **`null` means unlimited, not zero.** `Infinity` does not survive
 *   `JSON.stringify`, so it can never be the wire representation. Zero is a
 *   real limit meaning "none allowed", and the two must stay distinguishable —
 *   `phoneInboxes: 0` and `phoneInboxes: null` are opposite policies.
 *
 * - **Every field has a default, and the defaults are permissive.** Adding a
 *   key to this schema must not invalidate the Plan rows already seeded: a
 *   strict schema would make resolution throw for every organization at once,
 *   turning a code change into a total outage. Defaulting permissively means a
 *   newly added limit is unenforced until someone deliberately sets it, rather
 *   than enforcing a value nobody chose. `overQuotaBehavior` defaults to
 *   `overage` for the same reason — `drop` discards mail irrecoverably and can
 *   never be arrived at by omission.
 *
 * - **Unknown keys are stripped, not rejected.** During a rolling deploy an old
 *   container can read a row written by a new one. Stripping degrades to "that
 *   limit is not enforced on this container"; throwing would take the old
 *   container down mid-deploy.
 *
 * A *set* value is still validated strictly — `emailInboxes: 'lots'`, `1.5` or
 * `-1` all throw rather than silently becoming a default. Same posture as
 * `lib/config`: unset yields the default, malformed is a hard failure.
 */
const count = z.number().int().nonnegative().nullable().default(null)

export const PlanLimitsSchema = z.object({
  // ── resource counts ──────────────────────────────────────────────────────
  emailInboxes: count,
  phoneInboxes: count,
  apiKeys: count,
  webhooks: count,
  automations: count,
  members: count,

  // ── metered per billing period ───────────────────────────────────────────
  incomingEmailsPerPeriod: count,
  outboundEmailsPerPeriod: count,
  llmEnrichmentsPerPeriod: count,
  automationRunsPerPeriod: count,
  webhookDeliveriesPerPeriod: count,
  apiRequestsPerPeriod: count,

  // ── feature flags ────────────────────────────────────────────────────────
  /** Gates the send route, `forward_email` and `auto_reply` together. */
  outboundEmail: z.boolean().default(true),
  llmEnrichment: z.boolean().default(true),
  outboundWebhooks: z.boolean().default(true),
  automationsEnabled: z.boolean().default(true),
  phoneInboxesEnabled: z.boolean().default(true),
  mcpAccess: z.boolean().default(true),
  apiV1Access: z.boolean().default(true),
  messageSearch: z.boolean().default(true),

  // ── dimensions ───────────────────────────────────────────────────────────
  messageRetentionDays: count,
  maxAttachmentBytes: count,
  maxAutomationNodes: count,
  apiRateLimitPerMinute: count,

  // ── behaviour ────────────────────────────────────────────────────────────
  /**
   * What happens once a per-period meter is exhausted.
   *
   * `drop` — refuse the work. For inbound email this discards the message
   * permanently (issue #117 §6a); nothing is persisted and it cannot be
   * recovered by upgrading.
   *
   * `overage` — allow the work and keep counting past the limit, so the excess
   * can be surfaced or billed later.
   */
  overQuotaBehavior: z.enum(['drop', 'overage']).default('overage'),
})

export type PlanLimits = z.infer<typeof PlanLimitsSchema>

/**
 * The limits every organization gets when `USE_COMMERCIAL=false`, and the
 * limits seeded for the `self_hosted` plan.
 *
 * Derived by parsing an empty object rather than written out by hand, so it
 * cannot drift from the schema's defaults — adding a key updates both at once.
 */
export const UNLIMITED: PlanLimits = Object.freeze(PlanLimitsSchema.parse({}))

/**
 * True once `used` has reached `limit`. A `null` limit is unlimited and is
 * never reached.
 *
 * A helper rather than an inline comparison because `null` and `0` are both
 * falsy: a `!limit` guard would read a zero limit as unlimited and hand out
 * precisely the resource the plan forbids.
 */
export function isAtLimit(limit: number | null, used: number): boolean {
  return limit !== null && used >= limit
}
