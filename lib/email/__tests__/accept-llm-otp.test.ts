import { describe, it, expect } from 'vitest'
import { acceptLlmOtp } from '../extract-otp'

/**
 * Most cases are a one-sentence email, so the evidence defaults to the whole
 * body. Cases about the evidence itself call acceptLlmOtp directly.
 */
const accept = (
  otp: string | null | undefined,
  body: string | null | undefined,
  evidence: string | null | undefined = body,
) => acceptLlmOtp({ otp, evidence }, body)

describe('acceptLlmOtp', () => {
  describe('the code itself', () => {
    it('accepts a code that appears verbatim in the body', () => {
      expect(accept('851079', 'Enter this temporary code to continue: 851079')).toBe('851079')
    })

    it('accepts an alphanumeric code that appears verbatim', () => {
      expect(accept('A1B2C3', 'Your sign-in token A1B2C3 expires soon')).toBe('A1B2C3')
    })

    it('recovers a code the email splits with a single space, returning the contiguous form', () => {
      expect(accept('123456', 'Your verification code: 123 456')).toBe('123456')
    })

    it('recovers a code the email splits with hyphens', () => {
      expect(accept('123456', 'Your verification code: 12-34-56')).toBe('123456')
    })

    it('recovers a code split by a non-breaking space (html-to-text output)', () => {
      expect(accept('123456', 'Your verification code: 123 456')).toBe('123456')
    })

    it('recovers a code whose digits sit in separate table cells, one per line', () => {
      expect(accept('123456', 'Your verification code:\n1\n2\n3\n4\n5\n6')).toBe('123456')
    })

    it('normalises whitespace/hyphens the model itself left in its answer', () => {
      expect(accept(' 123 456 ', 'Your verification code: 123456')).toBe('123456')
    })

    it('rejects a code that is not in the body (hallucination)', () => {
      expect(accept('999999', 'Your verification code: 123456')).toBeNull()
    })

    it('is case-sensitive: a lowercased copy of an uppercase code is rejected', () => {
      expect(accept('a1b2c3', 'Your security token A1B2C3')).toBeNull()
    })

    it('rejects a code that is only a fragment of a longer token', () => {
      expect(accept('1234', 'Your verification code is 912345')).toBeNull()
      expect(accept('2345', 'Your verification code is 912345')).toBeNull()
    })

    it('rejects a match that would need more than one separator character', () => {
      expect(accept('123456', 'Your verification code: 123 - 456')).toBeNull()
    })

    it('rejects a candidate that is too short', () => {
      expect(accept('123', 'Your verification code: 123')).toBeNull()
    })

    it('rejects a candidate that is too long', () => {
      expect(accept('12345678901', 'Your verification code: 12345678901')).toBeNull()
    })

    it('rejects a candidate with no digit, matching the regex extractor', () => {
      expect(accept('ABCDEF', 'Your verification code: ABCDEF')).toBeNull()
    })

    it('rejects a candidate containing characters outside [A-Za-z0-9]', () => {
      expect(accept('12$456', 'Your verification code: 12$456')).toBeNull()
    })

    it('returns null for null, undefined and empty inputs', () => {
      const body = 'Your verification code: 123456'
      expect(accept(null, body)).toBeNull()
      expect(accept(undefined, body)).toBeNull()
      expect(accept('', body)).toBeNull()
      expect(accept('123456', null)).toBeNull()
      expect(accept('123456', '')).toBeNull()
    })
  })

  describe('the evidence', () => {
    const body = 'Your verification code: 123456'

    it.each([null, undefined, '', '   '])('is required: %j is rejected', (evidence) => {
      expect(acceptLlmOtp({ otp: '123456', evidence }, body)).toBeNull()
    })

    it('must appear in the body (fabricated evidence is rejected)', () => {
      expect(accept('123456', body, 'Your one-time code is 123456')).toBeNull()
    })

    it('must contain the code', () => {
      expect(accept('123456', body, 'Your verification code:')).toBeNull()
    })

    it('tolerates the whitespace differences html-to-text introduces', () => {
      expect(
        accept('851079', 'Your verification\ncode is\n\n851079', 'Your verification code is 851079'),
      ).toBe('851079')
    })

    it('is capped at 200 characters, so the model cannot hand back the whole email', () => {
      const long = `Your verification code is 851079. ${'x'.repeat(200)}`
      expect(accept('851079', long)).toBeNull()
    })

    it('may be one sentence of a larger body, so an unrelated promo elsewhere does not matter', () => {
      const email =
        'Welcome aboard! Your verification code is 851079. Discount code SAVE10 applies to your first order.'
      expect(accept('851079', email, 'Your verification code is 851079.')).toBe('851079')
    })

    it('must show a one-time-code signal, not just mention the token', () => {
      expect(accept('851079', 'Your reference is 851079')).toBeNull()
    })

    it.each([
      'Your one-time code is 851079',
      'Your OTP is 851079',
      'Your passcode is 851079',
      'Your sign-in token is 851079',
      'Your two-factor code is 851079',
      'Your 2FA code is 851079',
      'Your login PIN is 851079',
      'Use this code to verify your email: 851079',
    ])('recognises the signal in "%s"', (sentence) => {
      expect(accept('851079', sentence)).toBe('851079')
    })

    it.each([
      'Use promo code 851079 at checkout to confirm your verification',
      'Your verification coupon code is 851079',
      'Your security voucher code is 851079',
      'Your order number and verification code is 851079',
      'Your verification code is 851079, plus 20% off your next order',
      'Zip verification code 851079',
    ])('rejects promo/order look-alikes: "%s"', (sentence) => {
      expect(accept('851079', sentence)).toBeNull()
    })

    // Mirrors extractOtp(): a token with letters (SAVE20, SPRING25) is the
    // shape of a marketing code, so it needs the unambiguous compound phrase,
    // whereas digits-only tokens get the looser rule.
    describe('a code with letters needs an unambiguous phrase, like the regex extractor', () => {
      it('rejects it when the signal is only loosely connected to the word "code"', () => {
        expect(accept('SAVE20', 'Log in today and use code SAVE20 at checkout')).toBeNull()
      })

      it('rejects it next to a one-time/verification word that is not attached to the noun', () => {
        expect(accept('SPRING25', 'One-time bonus for verified members: use code SPRING25')).toBeNull()
      })

      it.each([
        'Your verification code is A1B2C3',
        'Your OTP is A1B2C3',
        'Your one-time code is A1B2C3',
        'Your Microsoft account security code is A1B2C3',
      ])('accepts it next to an unambiguous phrase: "%s"', (sentence) => {
        expect(accept('A1B2C3', sentence)).toBe('A1B2C3')
      })

      it('still gives a digits-only code the looser phrasing', () => {
        expect(accept('482913', 'Enter code 482913 to sign in')).toBe('482913')
      })
    })
  })

  describe('the text just before the code', () => {
    it('rejects a code that follows a disqualifying word closely, even when the evidence is clean', () => {
      expect(accept('851079', 'Referral: verification code 851079', 'verification code 851079')).toBeNull()
    })

    it('accepts the same evidence when the preceding text is harmless', () => {
      expect(accept('851079', 'Welcome: verification code 851079', 'verification code 851079')).toBe('851079')
    })

    it('ignores a disqualifying word that is far before the code', () => {
      const email = 'Promo terms apply to some orders. Otherwise, your verification code is 851079'
      expect(accept('851079', email, 'your verification code is 851079')).toBe('851079')
    })

    it('does not look after the code', () => {
      const email = 'Your verification code is 851079. Referral: friends'
      expect(accept('851079', email, 'Your verification code is 851079.')).toBe('851079')
    })
  })
})
