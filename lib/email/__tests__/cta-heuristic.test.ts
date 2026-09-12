import { describe, it, expect } from 'vitest'
import { classifyLinks } from '../cta-heuristic'

describe('classifyLinks', () => {
  it('flags a "Verify Email" link as a high-confidence CTA', () => {
    expect(classifyLinks([{ url: 'https://example.com/verify', label: 'Verify Email' }])).toEqual([
      { url: 'https://example.com/verify', label: 'Verify Email', isCta: true, ctaConfidence: 'high' },
    ])
  })

  it('flags "reset password" as a CTA regardless of case', () => {
    expect(classifyLinks([{ url: 'https://example.com/reset', label: 'reset password now' }])).toEqual([
      { url: 'https://example.com/reset', label: 'reset password now', isCta: true, ctaConfidence: 'high' },
    ])
  })

  it('flags "Unsubscribe" as a high-confidence non-CTA', () => {
    expect(classifyLinks([{ url: 'https://example.com/unsub', label: 'Unsubscribe' }])).toEqual([
      { url: 'https://example.com/unsub', label: 'Unsubscribe', isCta: false, ctaConfidence: 'high' },
    ])
  })

  it('flags "View in browser" as a high-confidence non-CTA', () => {
    expect(classifyLinks([{ url: 'https://example.com/web', label: 'View in browser' }])).toEqual([
      { url: 'https://example.com/web', label: 'View in browser', isCta: false, ctaConfidence: 'high' },
    ])
  })

  it('does not flag "Disclaimer" as a CTA even though it contains "claim" as a substring', () => {
    expect(classifyLinks([{ url: 'https://example.com/legal', label: 'Disclaimer' }])).toEqual([
      { url: 'https://example.com/legal', label: 'Disclaimer', isCta: false, ctaConfidence: 'low' },
    ])
  })

  it('still flags "Claim your reward" as a CTA (word-boundary match, not defeated by escaping)', () => {
    expect(classifyLinks([{ url: 'https://example.com/reward', label: 'Claim your reward' }])).toEqual([
      { url: 'https://example.com/reward', label: 'Claim your reward', isCta: true, ctaConfidence: 'high' },
    ])
  })

  it('leaves an unrecognized label as low-confidence, defaulting isCta to false', () => {
    expect(classifyLinks([{ url: 'https://example.com/x', label: 'Our new spring collection' }])).toEqual([
      { url: 'https://example.com/x', label: 'Our new spring collection', isCta: false, ctaConfidence: 'low' },
    ])
  })

  it('leaves a link with no label as low-confidence', () => {
    expect(classifyLinks([{ url: 'https://example.com/bare' }])).toEqual([
      { url: 'https://example.com/bare', isCta: false, ctaConfidence: 'low' },
    ])
  })

  it('classifies each link in a list independently', () => {
    const result = classifyLinks([
      { url: 'https://example.com/verify', label: 'Verify Email' },
      { url: 'https://example.com/unsub', label: 'Unsubscribe' },
      { url: 'https://example.com/x', label: 'Read our blog' },
    ])
    expect(result.map((l) => l.ctaConfidence)).toEqual(['high', 'high', 'low'])
    expect(result.map((l) => l.isCta)).toEqual([true, false, false])
  })
})
