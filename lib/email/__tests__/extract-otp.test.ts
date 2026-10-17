import { describe, it, expect } from 'vitest'
import { extractOtp } from '../extract-otp'

describe('extractOtp', () => {
  it('extracts a numeric code after "verification code is"', () => {
    expect(extractOtp('Your verification code is: 483920')).toBe('483920')
  })

  it('extracts an alphanumeric code after "security code"', () => {
    expect(extractOtp('Use security code A1B2C3 to continue.')).toBe('A1B2C3')
  })

  it('extracts a code that appears before the keyword ("123456 is your ... password")', () => {
    expect(extractOtp('123456 is your one-time password.')).toBe('123456')
  })

  it('extracts after a bare "code" keyword only when tightly connected via a colon', () => {
    expect(extractOtp('Your code: 745804')).toBe('745804')
  })

  it('does not treat a loosely-connected bare "code" as an OTP', () => {
    expect(extractOtp('Enter your discount code for 20% off your order.')).toBeNull()
  })

  it('does not match a bare "code" keyword with no digit nearby', () => {
    expect(extractOtp('Please refer to the code below for instructions.')).toBeNull()
  })

  it('returns null when no OTP-like keyword is present', () => {
    expect(extractOtp('Thanks for your order, it will ship soon.')).toBeNull()
  })

  it('returns null for null, undefined, or empty input', () => {
    expect(extractOtp(null)).toBeNull()
    expect(extractOtp(undefined)).toBeNull()
    expect(extractOtp('')).toBeNull()
  })

  it('prefers a strong keyword match over a weaker one earlier in the text', () => {
    expect(extractOtp('Your discount code is SAVE10. Your verification code is 918273.')).toBe('918273')
  })

  it('does not extract a promo code as an OTP', () => {
    expect(extractOtp('Use promo code: SAVE20 at checkout for 20% off.')).toBeNull()
  })

  it('does not extract a discount code as an OTP', () => {
    expect(extractOtp('Your discount code is SAVE10. Shop now!')).toBeNull()
  })

  it('does not extract a coupon code as an OTP', () => {
    expect(extractOtp('Coupon code = SPRING25')).toBeNull()
  })

  it('does not extract a referral code as an OTP', () => {
    expect(extractOtp('Referral code: FRIEND50 gets you $10')).toBeNull()
  })

  it('does not extract a zip code as an OTP', () => {
    expect(extractOtp('Your zip code is 94107 — update your address.')).toBeNull()
  })

  it('does not extract a source code reference as an OTP', () => {
    expect(extractOtp('Your source code: 123456')).toBeNull()
  })

  it('rejects an alphanumeric token on the weak keyword tier (digits-only for bare "code"/"pin")', () => {
    expect(extractOtp('Your code: AB12CD')).toBeNull()
  })

  describe('filler between the keyword and the code', () => {
    it('extracts a code after "to continue:" (ChatGPT login mail)', () => {
      expect(
        extractOtp('Enter this temporary verification code to continue:\n\n032078\n\nIf you were not trying to log in...'),
      ).toBe('032078')
    })

    it.each([
      ['Your verification code is below: 482913', '482913'],
      ['Use this login code to sign in 482913', '482913'],
      ['Enter the security code to proceed: 482913', '482913'],
    ])('extracts from %j', (text, code) => {
      expect(extractOtp(text)).toBe(code)
    })

    it('still requires a digit in the token after the filler', () => {
      expect(extractOtp('Enter the verification code to continue: abcdef')).toBeNull()
    })

    it('does not skip arbitrary text between the keyword and a number', () => {
      expect(extractOtp('Our verification code policy changed to 2024 standards')).toBeNull()
    })
  })
})
