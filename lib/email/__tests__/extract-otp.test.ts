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

  describe('subject-anchored bare code', () => {
    const body = 'You can sign up by entering the code on the sign up page.\n\n727226\n\nSign in with Magic Link'

    it('takes a code alone on its line when the subject names a one-time code', () => {
      expect(extractOtp(body, 'Your Notion signup code')).toBe('727226')
    })

    it('takes a body that is only the code', () => {
      expect(extractOtp('727226', 'Your Notion signup code')).toBe('727226')
    })

    it.each(['Your login code', 'Your verification code', 'Use passcode to continue', 'Your OTP'])(
      'accepts the subject %j',
      (subject) => {
        expect(extractOtp('483920', subject)).toBe('483920')
      },
    )

    it('recovers a code printed as two groups on its own line', () => {
      expect(extractOtp('Enter this to continue\n\n482 913\n', 'Your login code')).toBe('482913')
    })

    it('needs the subject: the same body with no subject yields nothing', () => {
      expect(extractOtp(body)).toBeNull()
      expect(extractOtp(body, 'Welcome to Notion')).toBeNull()
    })

    it('does not treat a bare "code" or "token" in the subject as a signal', () => {
      expect(extractOtp(body, 'Your code')).toBeNull()
    })

    it.each(['Your promo code', 'Your discount code is ready', 'Coupon code inside', 'Order number for your code'])(
      'refuses when the subject reads as a promotion or order: %j',
      (subject) => {
        expect(extractOtp('727226', subject)).toBeNull()
      },
    )

    it('refuses when two different tokens sit alone on their own lines', () => {
      expect(extractOtp('727226\n\n2026', 'Your login code')).toBeNull()
    })

    it('accepts the same token repeated, since it is still one candidate', () => {
      expect(extractOtp('727226\n\nSign in\n\n727226', 'Your login code')).toBe('727226')
    })

    it('ignores a token embedded in a sentence or a line of words', () => {
      expect(extractOtp('Order 727226 shipped', 'Your login code')).toBeNull()
    })

    it('ignores a line with no digit', () => {
      expect(extractOtp('Welcome\n\nNotion', 'Your login code')).toBeNull()
    })

    it('does not override a code the keyword tiers already found', () => {
      expect(extractOtp('Your verification code is 111222\n\n333444', 'Your login code')).toBe('111222')
    })
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
