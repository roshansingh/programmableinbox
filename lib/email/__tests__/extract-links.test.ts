import { describe, it, expect } from 'vitest'
import { extractLinks } from '../extract-links'

describe('extractLinks', () => {
  it('extracts href and anchor text from HTML', () => {
    const html = '<p>Hi</p><a href="https://example.com/verify?token=abc">Verify Email</a>'
    expect(extractLinks({ text: '', html })).toEqual([
      { url: 'https://example.com/verify?token=abc', label: 'Verify Email' },
    ])
  })

  it('omits label when the anchor has no text', () => {
    const html = '<a href="https://example.com/track"><img src="x.png"></a>'
    expect(extractLinks({ text: '', html })).toEqual([{ url: 'https://example.com/track' }])
  })

  it('dedupes repeated hrefs, keeping the first label seen', () => {
    const html = '<a href="https://example.com/a">First</a><a href="https://example.com/a">Second</a>'
    expect(extractLinks({ text: '', html })).toEqual([{ url: 'https://example.com/a', label: 'First' }])
  })

  it('drops non-http(s) schemes like mailto: and javascript:', () => {
    const html =
      '<a href="mailto:test@example.com">Email us</a>' +
      '<a href="javascript:void(0)">Click</a>' +
      '<a href="https://example.com/ok">OK</a>'
    expect(extractLinks({ text: '', html })).toEqual([{ url: 'https://example.com/ok', label: 'OK' }])
  })

  it('falls back to a bare-URL scan of plain text when there is no HTML', () => {
    const text = 'Visit https://example.com/offer for 20% off. Also see http://example.org/terms.'
    expect(extractLinks({ text, html: '' })).toEqual([
      { url: 'https://example.com/offer' },
      { url: 'http://example.org/terms' },
    ])
  })

  it('returns an empty array when there is no HTML and no URLs in text', () => {
    expect(extractLinks({ text: 'No links here.', html: '' })).toEqual([])
  })

  it('caps extraction at 50 links', () => {
    const html = Array.from({ length: 60 }, (_, i) => `<a href="https://example.com/${i}">Link ${i}</a>`).join('')
    expect(extractLinks({ text: '', html })).toHaveLength(50)
  })
})
