import { describe, it, expect } from 'vitest'
import { PlanLimitsSchema, UNLIMITED, isAtLimit, type PlanLimits } from '../plan-limits'

/**
 * `Plan.limits` is a Prisma `Json` column, so Prisma gives up type checking at
 * the boundary and this schema is the entire contract (issue #117 §4). These
 * tests pin the three properties that makes it safe to store limits as JSON.
 */
describe('PlanLimitsSchema', () => {
  it('parses a fully specified limits object', () => {
    const parsed = PlanLimitsSchema.parse({
      emailInboxes: 1,
      incomingEmailsPerPeriod: 1000,
      outboundEmail: false,
      llmEnrichment: false,
      overQuotaBehavior: 'drop',
    })

    expect(parsed.emailInboxes).toBe(1)
    expect(parsed.incomingEmailsPerPeriod).toBe(1000)
    expect(parsed.outboundEmail).toBe(false)
    expect(parsed.overQuotaBehavior).toBe('drop')
  })

  it('reads null as unlimited rather than as zero', () => {
    // Infinity does not survive JSON.stringify, so `null` is the wire
    // representation of "no limit". Zero is a real limit meaning "none allowed".
    const parsed = PlanLimitsSchema.parse({ emailInboxes: null })
    expect(parsed.emailInboxes).toBeNull()

    expect(PlanLimitsSchema.parse({ emailInboxes: 0 }).emailInboxes).toBe(0)
  })

  /**
   * Schema evolution is the reason every field has a default. Adding a new
   * limit key must not invalidate every already-seeded Plan row — that would
   * make resolution throw for every organization at once, which is a total
   * outage triggered by a code change alone.
   */
  it('defaults every omitted key, so an older plan row stays valid', () => {
    const parsed = PlanLimitsSchema.parse({})

    expect(parsed).toEqual(UNLIMITED)
  })

  it('defaults omitted keys permissively, so a new limit never enforces by accident', () => {
    const parsed = PlanLimitsSchema.parse({})

    expect(parsed.emailInboxes).toBeNull()
    expect(parsed.incomingEmailsPerPeriod).toBeNull()
    expect(parsed.outboundEmail).toBe(true)
    expect(parsed.llmEnrichment).toBe(true)
    // `drop` discards mail irrecoverably, so it can never be a default.
    expect(parsed.overQuotaBehavior).toBe('overage')
  })

  it('throws on a set-but-malformed count rather than falling back to a default', () => {
    expect(() => PlanLimitsSchema.parse({ emailInboxes: 'lots' })).toThrow()
    expect(() => PlanLimitsSchema.parse({ emailInboxes: 1.5 })).toThrow()
    expect(() => PlanLimitsSchema.parse({ emailInboxes: -1 })).toThrow()
  })

  it('throws on a malformed boolean', () => {
    expect(() => PlanLimitsSchema.parse({ outboundEmail: 'yes' })).toThrow()
  })

  it('throws on an unrecognised overQuotaBehavior', () => {
    expect(() => PlanLimitsSchema.parse({ overQuotaBehavior: 'bill_them' })).toThrow()
  })

  /**
   * Forward compatibility: a rolling deploy can have an old container read a
   * plan row written by a new one. Stripping an unknown key degrades to "that
   * limit is not enforced here" — throwing would take the old container down.
   */
  it('strips unknown keys instead of throwing', () => {
    const parsed = PlanLimitsSchema.parse({ emailInboxes: 2, someFutureLimit: 99 })

    expect(parsed.emailInboxes).toBe(2)
    expect(parsed).not.toHaveProperty('someFutureLimit')
  })
})

describe('UNLIMITED', () => {
  it('enforces nothing at all', () => {
    const counts: (keyof PlanLimits)[] = [
      'emailInboxes',
      'phoneInboxes',
      'apiKeys',
      'webhooks',
      'automations',
      'members',
      'incomingEmailsPerPeriod',
      'outboundEmailsPerPeriod',
      'llmEnrichmentsPerPeriod',
      'automationRunsPerPeriod',
      'webhookDeliveriesPerPeriod',
      'apiRequestsPerPeriod',
      'messageRetentionDays',
      'maxAttachmentBytes',
      'maxAutomationNodes',
      'apiRateLimitPerMinute',
    ]
    for (const key of counts) {
      expect(UNLIMITED[key], `${key} must be unlimited`).toBeNull()
    }

    const features: (keyof PlanLimits)[] = [
      'outboundEmail',
      'llmEnrichment',
      'outboundWebhooks',
      'automationsEnabled',
      'phoneInboxesEnabled',
      'mcpAccess',
      'apiV1Access',
      'messageSearch',
    ]
    for (const key of features) {
      expect(UNLIMITED[key], `${key} must be enabled`).toBe(true)
    }
  })

  it('is itself a valid limits object', () => {
    expect(() => PlanLimitsSchema.parse(UNLIMITED)).not.toThrow()
  })

  it('covers every key the schema defines, so no limit is silently absent', () => {
    expect(Object.keys(UNLIMITED).sort()).toEqual(Object.keys(PlanLimitsSchema.shape).sort())
  })
})

describe('isAtLimit', () => {
  it('never reports a null limit as reached', () => {
    expect(isAtLimit(null, 0)).toBe(false)
    expect(isAtLimit(null, 1_000_000)).toBe(false)
  })

  /**
   * The bug this helper exists to prevent: `null` and `0` are both falsy, so a
   * `!limit` guard would treat a zero limit as unlimited and hand out exactly
   * the resource the plan forbids.
   */
  it('reports a zero limit as reached at zero usage', () => {
    expect(isAtLimit(0, 0)).toBe(true)
  })

  it('reports reached only once usage meets the limit', () => {
    expect(isAtLimit(1, 0)).toBe(false)
    expect(isAtLimit(1, 1)).toBe(true)
    expect(isAtLimit(1, 2)).toBe(true)
  })
})
