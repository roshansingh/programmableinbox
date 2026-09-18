import { describe, it, expect } from 'vitest'
import { deriveIngestionFields } from '../derive-ingestion-fields'

describe('deriveIngestionFields', () => {
  it('derives body text, the regex OTP and classified links from an HTML-only email', () => {
    const html =
      '<p>Your verification code is <strong>483920</strong></p>' +
      '<a href="https://example.com/verify">Verify email</a>'

    const fields = deriveIngestionFields({ text: '', html })

    expect(fields.bodyText).toContain('483920')
    expect(fields.extractedOtp).toBe('483920')
    expect(fields.links).toEqual([
      { url: 'https://example.com/verify', label: 'Verify email', isCta: true, ctaConfidence: 'high' },
    ])
  })

  it('prefers the provided text part over the HTML for both the body text and the OTP', () => {
    const fields = deriveIngestionFields({
      text: 'Your security code is 111222',
      html: '<p>Your security code is 999888</p>',
    })

    expect(fields.bodyText).toBe('Your security code is 111222')
    expect(fields.extractedOtp).toBe('111222')
  })

  it('returns nulls and no links for an empty email', () => {
    expect(deriveIngestionFields({ text: '', html: '' })).toEqual({
      bodyText: null,
      extractedOtp: null,
      links: [],
    })
  })

  it('does not treat a discount code as an OTP, and leaves a marketing link low-confidence', () => {
    const fields = deriveIngestionFields({
      text: '',
      html:
        '<p>Use discount code SPRING25 for 25% off at checkout.</p>' +
        '<a href="https://shop.example.com/sale">Shop the sale</a>',
    })

    expect(fields.extractedOtp).toBeNull()
    expect(fields.links).toEqual([
      { url: 'https://shop.example.com/sale', label: 'Shop the sale', isCta: false, ctaConfidence: 'low' },
    ])
  })
})
