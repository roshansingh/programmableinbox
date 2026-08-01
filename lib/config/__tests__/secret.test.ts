import { describe, it, expect } from 'vitest'
import { inspect } from 'node:util'
import { Secret, zSecret } from '../secret'

describe('Secret', () => {
  it('reveals the raw value only via reveal()', () => {
    expect(new Secret('hunter2').reveal()).toBe('hunter2')
  })

  it('renders [redacted] for toString and template interpolation', () => {
    const s = new Secret('hunter2')
    expect(String(s)).toBe('[redacted]')
    expect(`${s}`).toBe('[redacted]')
  })

  it('renders [redacted] under JSON.stringify, which is what Pino uses', () => {
    const s = new Secret('hunter2')
    expect(JSON.stringify({ s })).toBe('{"s":"[redacted]"}')
    expect(JSON.stringify({ s })).not.toContain('hunter2')
  })

  it('renders [redacted] under util.inspect, which is what console.log uses', () => {
    expect(inspect(new Secret('hunter2'))).not.toContain('hunter2')
    expect(inspect({ nested: new Secret('hunter2') })).toContain('[redacted]')
  })
})

describe('zSecret', () => {
  it('boxes a valid value', () => {
    const parsed = zSecret().parse('  spaced-secret  ')
    expect(parsed).toBeInstanceOf(Secret)
    expect(parsed.reveal()).toBe('spaced-secret')
  })

  it('rejects a whitespace-only value', () => {
    expect(() => zSecret().parse('   ')).toThrow()
  })

  it('enforces a minimum length after trimming', () => {
    expect(() => zSecret({ min: 16 }).parse('short')).toThrow()
    expect(zSecret({ min: 16 }).parse('a'.repeat(16)).reveal()).toBe('a'.repeat(16))
  })

  it('never echoes the offending value in the error message', () => {
    try {
      zSecret({ min: 16 }).parse('leaky-value')
      throw new Error('expected zSecret to throw')
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain('leaky-value')
    }
  })
})
