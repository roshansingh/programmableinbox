import { describe, expect, it } from 'vitest'
import { checkOrigin } from '../origin'

describe('checkOrigin', () => {
  it('allows a request with no Origin header — every supported client sends none', () => {
    expect(checkOrigin(null, [])).toEqual({ allowed: true })
    expect(checkOrigin(null, ['https://app.example.com'])).toEqual({ allowed: true })
  })

  it('refuses any browser origin when the allowlist is empty (the default)', () => {
    expect(checkOrigin('https://evil.example', [])).toEqual({
      allowed: false,
      origin: 'https://evil.example',
    })
    // The rebinding case: a hostname the attacker controls, pointed at us.
    expect(checkOrigin('http://localhost:4000', [])).toEqual({
      allowed: false,
      origin: 'http://localhost:4000',
    })
  })

  it('allows an origin on the list', () => {
    expect(checkOrigin('https://app.example.com', ['https://app.example.com'])).toEqual({
      allowed: true,
    })
  })

  it('refuses an origin that is not on the list', () => {
    expect(checkOrigin('https://evil.example', ['https://app.example.com'])).toEqual({
      allowed: false,
      origin: 'https://evil.example',
    })
  })

  it('compares parsed origins, so a trailing slash or default port still matches', () => {
    expect(checkOrigin('https://app.example.com', ['https://app.example.com/'])).toEqual({
      allowed: true,
    })
    expect(checkOrigin('https://app.example.com', ['https://app.example.com:443'])).toEqual({
      allowed: true,
    })
  })

  it('does not match on substrings — a lookalike host is a different origin', () => {
    expect(checkOrigin('https://app.example.com.evil.test', ['https://app.example.com']))
      .toEqual({ allowed: false, origin: 'https://app.example.com.evil.test' })
  })

  it('distinguishes scheme and port', () => {
    expect(checkOrigin('http://app.example.com', ['https://app.example.com']).allowed).toBe(
      false,
    )
    expect(
      checkOrigin('https://app.example.com:8443', ['https://app.example.com']).allowed,
    ).toBe(false)
  })

  it('refuses an unparseable Origin rather than letting it through', () => {
    expect(checkOrigin('not-a-url', ['https://app.example.com']).allowed).toBe(false)
    expect(checkOrigin('', ['https://app.example.com']).allowed).toBe(false)
  })

  it('never treats the literal "null" origin as allowed', () => {
    // A sandboxed iframe or data: document sends Origin: null.
    expect(checkOrigin('null', ['null']).allowed).toBe(false)
  })

  it('ignores a malformed allowlist entry instead of matching everything', () => {
    expect(checkOrigin('https://app.example.com', ['not-a-url']).allowed).toBe(false)
    // A good entry alongside a bad one still works.
    expect(
      checkOrigin('https://app.example.com', ['not-a-url', 'https://app.example.com'])
        .allowed,
    ).toBe(true)
  })
})
