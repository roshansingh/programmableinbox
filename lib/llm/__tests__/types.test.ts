import { describe, it, expect } from 'vitest'
import { parseEnrichmentResult, buildEnrichmentJsonSchema } from '../types'

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
