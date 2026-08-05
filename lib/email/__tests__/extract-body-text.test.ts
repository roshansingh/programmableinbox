import { describe, expect, it } from 'vitest'
import { deriveBodyText, MAX_BODY_TEXT_LENGTH } from '../extract-body-text'

describe('deriveBodyText', () => {
  it('prefers the sender-supplied text part over the html', () => {
    const result = deriveBodyText({
      text: 'the plain part',
      html: '<p>the html part</p>',
    })

    expect(result).toBe('the plain part')
  })

  it('extracts text from html when the sender supplied no text part', () => {
    const result = deriveBodyText({
      text: '',
      html: '<p>Hello, your code is 123456</p>',
    })

    expect(result).toBe('Hello, your code is 123456')
  })

  it('treats a whitespace-only text part as absent', () => {
    const result = deriveBodyText({
      text: '   \n\t  ',
      html: '<p>from the html</p>',
    })

    expect(result).toBe('from the html')
  })

  it('does not index css from style blocks', () => {
    const result = deriveBodyText({
      text: '',
      html:
        '<html><head><style>.promo-banner { color: red } .cta { margin: 0 }</style></head>' +
        '<body><p>Your receipt</p></body></html>',
    })

    expect(result).toBe('Your receipt')
    expect(result).not.toContain('promo-banner')
  })

  it('does not index script contents', () => {
    const result = deriveBodyText({
      text: '',
      html: '<body><script>var trackingPixel = 1;</script><p>Order shipped</p></body>',
    })

    expect(result).toBe('Order shipped')
    expect(result).not.toContain('trackingPixel')
  })

  it('decodes html entities', () => {
    const result = deriveBodyText({ text: '', html: '<p>Ben &amp; Jerry&#39;s</p>' })

    expect(result).toBe("Ben & Jerry's")
  })

  it('does not inline link hrefs into the indexed text', () => {
    const result = deriveBodyText({
      text: '',
      html: '<p><a href="https://tracking.example.com/abcdef123456">Unsubscribe</a></p>',
    })

    expect(result).toBe('Unsubscribe')
    expect(result).not.toContain('tracking.example.com')
  })

  it('truncates at the cap so the generated tsvector cannot exceed its limit', () => {
    const result = deriveBodyText({ text: 'a'.repeat(MAX_BODY_TEXT_LENGTH + 5_000), html: '' })

    expect(result).toHaveLength(MAX_BODY_TEXT_LENGTH)
  })

  it('truncates html-derived text at the same cap', () => {
    const result = deriveBodyText({
      text: '',
      html: `<p>${'word '.repeat(MAX_BODY_TEXT_LENGTH)}</p>`,
    })

    expect(result).toHaveLength(MAX_BODY_TEXT_LENGTH)
  })

  it('returns null when there is no body at all', () => {
    expect(deriveBodyText({ text: '', html: '' })).toBeNull()
  })

  it('returns null when the html carries no text', () => {
    expect(deriveBodyText({ text: '', html: '<style>.a{color:red}</style>' })).toBeNull()
  })

  it('survives malformed html without throwing', () => {
    const result = deriveBodyText({ text: '', html: '<p>unclosed <b>bold' })

    expect(result).toContain('unclosed')
  })
})
