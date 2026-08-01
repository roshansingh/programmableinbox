import { describe, it, expect } from 'vitest'
import { emptyAsUndefined, zBool, zBoundedInt, zNonEmpty, zUrl } from '../primitives'

describe('emptyAsUndefined', () => {
  it.each([undefined, '', '   ', '\t\n'])('treats %j as unset', (raw) => {
    expect(emptyAsUndefined(raw)).toBeUndefined()
  })

  it('preserves a real value verbatim, without trimming', () => {
    expect(emptyAsUndefined(' keep me ')).toBe(' keep me ')
  })
})

describe('zBool', () => {
  it.each(['true', 'TRUE', 'True', '1', 'yes', 'YES', 'on'])('parses %s as true', (raw) => {
    expect(zBool.parse(raw)).toBe(true)
  })

  it.each(['false', 'FALSE', '0', 'no', 'off'])('parses %s as false', (raw) => {
    expect(zBool.parse(raw)).toBe(false)
  })

  it.each(['maybe', 'truthy', '2', 'y'])('rejects %s instead of reading it as false', (raw) => {
    expect(() => zBool.parse(raw)).toThrow()
  })
})

describe('zBoundedInt', () => {
  it('parses a numeric string into a number', () => {
    const parsed = zBoundedInt(1, 100).parse('5')
    expect(parsed).toBe(5)
    expect(typeof parsed).toBe('number')
  })

  it.each(['abc', 'NaN', '-5', '0', '3.5', '101', '1e2'])('rejects %s', (raw) => {
    expect(() => zBoundedInt(1, 100).parse(raw)).toThrow()
  })

  it('accepts the boundary values', () => {
    expect(zBoundedInt(1, 100).parse('1')).toBe(1)
    expect(zBoundedInt(1, 100).parse('100')).toBe(100)
  })
})

describe('zUrl', () => {
  it('accepts a postgres connection URL', () => {
    const url = 'postgresql://u:p@h:5432/db'
    expect(zUrl().parse(url)).toBe(url)
  })

  it.each(['not a url', ''])('rejects %j', (raw) => {
    expect(() => zUrl().parse(raw)).toThrow()
  })

  it('rejects a hostless URL rather than letting it be rewritten to localhost', () => {
    // `new URL('localhost:6379')` succeeds — protocol "localhost:", empty host.
    // This is the shape buildRedisOptions() used to silently turn into 127.0.0.1.
    expect(() => zUrl().parse('localhost:6379')).toThrow(/host/)
    expect(() => zUrl(['redis:']).parse('redis:///0')).toThrow(/host/)
  })

  it('enforces a protocol allowlist when given one', () => {
    expect(zUrl(['redis:', 'rediss:']).parse('redis://localhost:6379')).toBe(
      'redis://localhost:6379',
    )
    expect(() => zUrl(['redis:', 'rediss:']).parse('http://localhost:6379')).toThrow()
  })
})

describe('zNonEmpty', () => {
  it('trims and accepts a real value', () => {
    expect(zNonEmpty.parse('  hello  ')).toBe('hello')
  })

  it('rejects a whitespace-only value', () => {
    expect(() => zNonEmpty.parse('   ')).toThrow()
  })
})
