import { describe, expect, it } from 'vitest'
import {
  PASSWORD_TOO_LONG,
  PASSWORD_TOO_SHORT,
  validatePassword,
} from '../password'

describe('validatePassword', () => {
  it('accepts a password at the minimum length', () => {
    expect(validatePassword('12345678')).toBeNull()
  })

  it('rejects one character below the minimum', () => {
    expect(validatePassword('1234567')).toBe(PASSWORD_TOO_SHORT)
  })

  it('accepts a password at the maximum length', () => {
    expect(validatePassword('a'.repeat(72))).toBeNull()
  })

  it('rejects one character above the maximum', () => {
    expect(validatePassword('a'.repeat(73))).toBe(PASSWORD_TOO_LONG)
  })

  it('measures the cap in bytes, not characters, because bcrypt does', () => {
    // 24 four-byte characters = 96 bytes, over the limit despite being 24 long
    expect(validatePassword('😀'.repeat(24))).toBe(PASSWORD_TOO_LONG)
  })

  it('rejects a non-string', () => {
    expect(validatePassword(undefined)).toBe(PASSWORD_TOO_SHORT)
    expect(validatePassword(12345678)).toBe(PASSWORD_TOO_SHORT)
  })

  it('does not trim — a space is a legitimate password character', () => {
    expect(validatePassword('  abcdef  ')).toBeNull()
  })
})
