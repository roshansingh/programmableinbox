import { describe, it, expect } from 'vitest'
import {
  parseEnrichmentResult,
  buildEnrichmentJsonSchema,
  EMAIL_CATEGORIES,
  EMAIL_CATEGORY_DEFINITIONS,
} from '../types'
import { buildSystemPrompt } from '../prompt'

describe('parseEnrichmentResult otp', () => {
  it('passes a string otp through', () => {
    expect(parseEnrichmentResult({ categories: ['Security'], otp: '123456' }).otp).toBe('123456')
  })

  it('defaults otp to null when the model did not return one', () => {
    expect(parseEnrichmentResult({ categories: ['Security'] }).otp).toBeNull()
  })

  it('keeps an explicit null as null', () => {
    expect(parseEnrichmentResult({ categories: ['Security'], otp: null }).otp).toBeNull()
  })

  it.each([123456, true, {}, ['123456']])('coerces a non-string otp (%j) to null', (bad) => {
    expect(parseEnrichmentResult({ categories: ['Security'], otp: bad }).otp).toBeNull()
  })

  it('reports otp and otpEvidence as null for unusable input, alongside the existing empty fields', () => {
    expect(parseEnrichmentResult(null)).toEqual({
      categories: [],
      ctaJudgments: [],
      timestamps: [],
      otp: null,
      otpEvidence: null,
    })
  })
})

describe('parseEnrichmentResult otpEvidence', () => {
  it('passes a string otpEvidence through', () => {
    const raw = { categories: ['Security'], otp: '123456', otpEvidence: 'Your code is 123456' }
    expect(parseEnrichmentResult(raw).otpEvidence).toBe('Your code is 123456')
  })

  it('defaults otpEvidence to null when absent or explicitly null', () => {
    expect(parseEnrichmentResult({ categories: ['Security'] }).otpEvidence).toBeNull()
    expect(parseEnrichmentResult({ categories: ['Security'], otpEvidence: null }).otpEvidence).toBeNull()
  })

  it.each([123456, true, {}, ['x']])('coerces a non-string otpEvidence (%j) to null', (bad) => {
    expect(parseEnrichmentResult({ categories: ['Security'], otpEvidence: bad }).otpEvidence).toBeNull()
  })
})

describe('buildEnrichmentJsonSchema', () => {
  // The otp fields are the fallback's question. A request that is not asking
  // must not show them: an Anthropic tool definition is part of the prompt, so
  // a schema that lists `otp` invites the model to volunteer one and spends
  // output tokens on an answer the caller then discards.
  it('leaves otp and otpEvidence out unless the caller asks for a code', () => {
    for (const schema of [buildEnrichmentJsonSchema(), buildEnrichmentJsonSchema({}), buildEnrichmentJsonSchema({ extractOtp: false })]) {
      expect(schema.properties).not.toHaveProperty('otp')
      expect(schema.properties).not.toHaveProperty('otpEvidence')
    }
  })

  it('keeps the classification fields in every variant', () => {
    for (const extractOtp of [false, true]) {
      const schema = buildEnrichmentJsonSchema({ extractOtp })
      expect(Object.keys(schema.properties)).toEqual(
        expect.arrayContaining(['categories', 'ctaJudgments', 'timestamps']),
      )
      expect(schema.required).toEqual(['categories', 'ctaJudgments', 'timestamps'])
    }
  })

  // Plain optional strings rather than ['string', 'null']: a type array is
  // valid JSON Schema but is one more thing a provider's tool-schema
  // validator could reject, and the parser already turns absent and null
  // into the same thing.
  it('describes otp and otpEvidence as plain strings when asked', () => {
    const schema = buildEnrichmentJsonSchema({ extractOtp: true })
    expect(schema.properties.otp).toEqual({ type: 'string' })
    expect(schema.properties.otpEvidence).toEqual({ type: 'string' })
  })

  it('does not require either, since a response without them is the normal case', () => {
    const { required } = buildEnrichmentJsonSchema({ extractOtp: true })
    expect(required).not.toContain('otp')
    expect(required).not.toContain('otpEvidence')
  })

  it('does not share mutable state between variants', () => {
    buildEnrichmentJsonSchema({ extractOtp: true })
    expect(buildEnrichmentJsonSchema().properties).not.toHaveProperty('otp')
  })
})

// "Updates" was retired: it overlapped Notifications, Receipts and Support, and
// in practice pulled login/reset mail away from Security. Messages classified
// before the change keep the label (the column is free-form), but nothing may
// offer it or accept it again.
describe('the retired "Updates" category', () => {
  it('is not in the category list, the tool schema enum, or the system prompt', () => {
    const schema = buildEnrichmentJsonSchema()

    expect(EMAIL_CATEGORIES as readonly string[]).not.toContain('Updates')
    expect(schema.properties.categories.items.enum).not.toContain('Updates')
    expect(buildSystemPrompt()).not.toMatch(/\bUpdates\b/)
  })

  it('is dropped from a model response that still returns it, keeping the valid ones', () => {
    const result = parseEnrichmentResult({ categories: ['Security', 'Updates'] })

    expect(result.categories).toEqual(['Security'])
  })

  it('leaves no categories when it was the only one returned, which enrichMessage treats as a retryable failure', () => {
    expect(parseEnrichmentResult({ categories: ['Updates'] }).categories).toEqual([])
  })
})

// The definitions are what the model reads to decide a label, so they are what
// makes the same email get the same category run after run.
describe('EMAIL_CATEGORY_DEFINITIONS', () => {
  it.each([...EMAIL_CATEGORIES])('%s has a non-empty, single-line definition', (category) => {
    const definition = EMAIL_CATEGORY_DEFINITIONS[category]

    expect(definition.trim()).not.toBe('')
    expect(definition).not.toMatch(/\n/)
    expect(definition.length).toBeLessThanOrEqual(140)
  })

  it('defines Security as the home of sign-in mail: verification codes, password resets and login alerts', () => {
    const security = EMAIL_CATEGORY_DEFINITIONS.Security

    expect(security).toMatch(/verification/i)
    expect(security).toMatch(/password reset/i)
    expect(security).toMatch(/sign-in|login/i)
  })

  // "bot" made Agents overlap Notifications: routine no-reply alerts are also
  // sent by bots, and the prompt allows two labels, so the model could tag
  // nearly any automated email as Agents. The boundary has to be stated.
  it('keeps Agents apart from Notifications: no "bot", and routine service notifications are excluded', () => {
    const agents = EMAIL_CATEGORY_DEFINITIONS.Agents

    expect(agents).not.toMatch(/\bbots?\b/i)
    expect(agents).toMatch(/not routine service notifications/i)
  })
})
