import { describe, it, expect } from 'vitest'
import { parseEnrichmentResult, ENRICHMENT_JSON_SCHEMA } from '../types'

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

describe('ENRICHMENT_JSON_SCHEMA otp', () => {
  // Plain optional strings rather than ['string', 'null']: a type array is
  // valid JSON Schema but is one more thing a provider's tool-schema
  // validator could reject, and the parser already turns absent and null
  // into the same thing.
  it('describes otp and otpEvidence as plain strings', () => {
    expect(ENRICHMENT_JSON_SCHEMA.properties.otp).toEqual({ type: 'string' })
    expect(ENRICHMENT_JSON_SCHEMA.properties.otpEvidence).toEqual({ type: 'string' })
  })

  it('does not require either, since most requests never ask for an otp', () => {
    expect(ENRICHMENT_JSON_SCHEMA.required).not.toContain('otp')
    expect(ENRICHMENT_JSON_SCHEMA.required).not.toContain('otpEvidence')
  })
})
