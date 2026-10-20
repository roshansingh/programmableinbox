import { readFileSync } from 'node:fs'
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

  // Notion's login email, as received: the text alternative is only the code
  // and the sentence around it exists only in the HTML.
  describe('Notion signup email (stub text part, code only in a <pre>)', () => {
    const html = readFileSync(new URL('./fixtures/notion-signup-code.html', import.meta.url), 'utf8')
    const email = { text: '727226', html, subject: 'Your Notion signup code' }

    it('derives the body text from the html and extracts the code', () => {
      const fields = deriveIngestionFields(email)

      expect(fields.bodyText).toContain('You can sign up by entering the code')
      expect(fields.extractedOtp).toBe('727226')
    })

    it('extracts the code when the text part is absent entirely', () => {
      expect(deriveIngestionFields({ ...email, text: '' }).extractedOtp).toBe('727226')
    })

    it('does not extract it without the subject', () => {
      const { subject: _subject, ...withoutSubject } = email
      expect(deriveIngestionFields(withoutSubject).extractedOtp).toBeNull()
    })

    it('does not extract it under an unrelated subject', () => {
      expect(deriveIngestionFields({ ...email, subject: 'Welcome to Notion' }).extractedOtp).toBeNull()
    })
  })
})
