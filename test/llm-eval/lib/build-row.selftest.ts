import { describe, expect, it } from 'vitest'
import { buildRow, deriveSubject, toSnapshot } from './build-row'

const OTP_HTML =
  '<html><head><title>Your Acme verification code</title></head><body>' +
  '<p>Your verification code is <strong>483920</strong></p>' +
  '<a href="https://example.com/verify">Verify email</a></body></html>'

describe('deriveSubject', () => {
  it('uses the <title>', () => {
    expect(deriveSubject(OTP_HTML, 'fallback')).toBe('Your Acme verification code')
  })

  it('decodes common entities and collapses whitespace', () => {
    expect(deriveSubject('<title>\n  Code &amp; receipt &#39;24\n</title>', 'fallback')).toBe(
      "Code & receipt '24",
    )
  })

  it('falls back when there is no title or it is empty', () => {
    expect(deriveSubject('<p>hi</p>', 'fallback')).toBe('fallback')
    expect(deriveSubject('<title>   </title>', 'fallback')).toBe('fallback')
  })

  it('ignores an out-of-range numeric entity instead of throwing', () => {
    expect(deriveSubject('<title>x &#99999999; y</title>', 'fallback')).toBe('x &#99999999; y')
  })
})

describe('buildRow', () => {
  it('builds the row ingestion would store for an HTML-only email', () => {
    const row = buildRow({ id: 'security/otp:withoutLlm', caseId: 'security/otp', html: OTP_HTML })

    expect(row.id).toBe('security/otp:withoutLlm')
    expect(row.subject).toBe('Your Acme verification code')
    expect(row.text).toBe('')
    expect(row.html).toBe(OTP_HTML)
    expect(row.bodyText).toContain('483920')
    expect(row.extractedOtp).toBe('483920')
    expect(row.categories).toEqual([])
    expect(row.metadata.timestamps).toEqual([])
    expect(row.metadata.links).toEqual([
      { url: 'https://example.com/verify', label: 'Verify email', isCta: true, ctaConfidence: 'high' },
    ])
  })

  it('names the subject after the last folder segment when there is no <title>', () => {
    const row = buildRow({ id: 'x', caseId: 'security/otp-1', html: '<p>Use sign-in token A1B2C3</p>' })

    expect(row.subject).toBe('otp-1')
  })

  it('leaves extractedOtp null for a discount code', () => {
    const row = buildRow({
      id: 'x',
      caseId: 'promo',
      html: '<p>Use discount code SPRING25 for 25% off.</p>',
    })

    expect(row.extractedOtp).toBeNull()
  })
})

describe('toSnapshot', () => {
  it('copies exactly the judged fields, and detaches them from the row', () => {
    const row = buildRow({ id: 'x', caseId: 'otp', html: OTP_HTML })
    row.categories = ['Security']

    const snapshot = toSnapshot(row)
    snapshot.categories.push('Spam')
    snapshot.metadata.links[0].isCta = false

    expect(Object.keys(snapshot).sort()).toEqual(['categories', 'extractedOtp', 'metadata'])
    expect(row.categories).toEqual(['Security'])
    expect(row.metadata.links[0].isCta).toBe(true)
  })
})
