import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PlanLimitsSchema } from '../plan-limits'
import { SELF_HOSTED_PLAN_CODE } from '../interfaces'

/**
 * The plans are seeded by SQL in a migration, which no type checker reads. This
 * suite parses the seeded JSON back through `PlanLimitsSchema` so a typo in the
 * migration — a misspelled key silently stripped, a limit of the wrong type —
 * fails here rather than at runtime on a customer's first request.
 *
 * It reads the migration file rather than a duplicated fixture on purpose: a
 * fixture would drift from the SQL and pin nothing.
 */
function seededLimits(): Map<string, unknown> {
  const migrationsDir = join(process.cwd(), 'prisma', 'migrations')
  const dir = readdirSync(migrationsDir).find((d) => d.endsWith('_use_commercial_plans'))
  if (!dir) throw new Error('use_commercial_plans migration not found')

  const sql = readFileSync(join(migrationsDir, dir, 'migration.sql'), 'utf8')

  // Each seeded row is `'<code>', '<name>', '<json>'::jsonb`.
  const rows = new Map<string, unknown>()
  const re = /'([a-z_]+)',\s*'[^']*',\s*(?:--[^\n]*\n\s*)*'(\{.*?\})'::jsonb/gs
  for (const match of sql.matchAll(re)) {
    rows.set(match[1], JSON.parse(match[2]))
  }
  return rows
}

describe('seeded plans', () => {
  const plans = seededLimits()

  it('seeds exactly the three known plan codes', () => {
    expect([...plans.keys()].sort()).toEqual(['free', 'pro', SELF_HOSTED_PLAN_CODE].sort())
  })

  it.each([...seededLimits().keys()])('%s has limits valid under PlanLimitsSchema', (code) => {
    expect(() => PlanLimitsSchema.parse(plans.get(code))).not.toThrow()
  })

  it('leaves self_hosted entirely unrestricted', () => {
    const limits = PlanLimitsSchema.parse(plans.get(SELF_HOSTED_PLAN_CODE))

    expect(limits.emailInboxes).toBeNull()
    expect(limits.incomingEmailsPerPeriod).toBeNull()
    expect(limits.outboundEmail).toBe(true)
    expect(limits.llmEnrichment).toBe(true)
  })

  it('restricts free to 1 inbox, 1000 inbound emails, and no outbound or LLM', () => {
    const limits = PlanLimitsSchema.parse(plans.get('free'))

    expect(limits.emailInboxes).toBe(1)
    expect(limits.incomingEmailsPerPeriod).toBe(1000)
    expect(limits.outboundEmail).toBe(false)
    expect(limits.llmEnrichment).toBe(false)
  })

  it('gives pro 2 inboxes, 5000 inbound emails, and both outbound and LLM', () => {
    const limits = PlanLimitsSchema.parse(plans.get('pro'))

    expect(limits.emailInboxes).toBe(2)
    expect(limits.incomingEmailsPerPeriod).toBe(5000)
    expect(limits.outboundEmail).toBe(true)
    expect(limits.llmEnrichment).toBe(true)
  })

  /**
   * `drop` discards inbound mail permanently. It must never be reachable by
   * omission, so the seeds have to state it explicitly wherever it applies.
   */
  it('states overQuotaBehavior explicitly on every capped plan', () => {
    expect(PlanLimitsSchema.parse(plans.get('free')).overQuotaBehavior).toBe('drop')
    expect(PlanLimitsSchema.parse(plans.get('pro')).overQuotaBehavior).toBe('drop')
    // Unlimited plans never reach a cap, so the default is correct there.
    expect(PlanLimitsSchema.parse(plans.get(SELF_HOSTED_PLAN_CODE)).overQuotaBehavior).toBe('overage')
  })

  /**
   * Sparse storage is the point: a plan row lists only what it restricts, and
   * everything else comes from the schema's defaults. That is what lets a new
   * limit be added without re-seeding every row.
   */
  it('stores limits sparsely rather than spelling out every key', () => {
    const free = plans.get('free') as Record<string, unknown>

    expect(Object.keys(free).length).toBeLessThan(Object.keys(PlanLimitsSchema.shape).length)
    expect(free).not.toHaveProperty('apiKeys')
  })
})
