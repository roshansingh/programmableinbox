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
})
