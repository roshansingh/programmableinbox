import { describe, expect, it } from 'vitest'
import {
  clampLimit,
  clampPage,
  parsePagination,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_OFFSET,
  MAX_UNPAGINATED_ROWS,
  OffsetTooLargeError,
} from '../params'

function params(query: string): URLSearchParams {
  return new URLSearchParams(query)
}

describe('constants', () => {
  it('exposes sane bounds', () => {
    expect(DEFAULT_LIMIT).toBe(50)
    expect(MAX_LIMIT).toBe(100)
    expect(MAX_OFFSET).toBe(10_000)
    expect(MAX_UNPAGINATED_ROWS).toBe(500)
  })
})

describe('clampLimit', () => {
  it('returns the default when the value is missing', () => {
    expect(clampLimit(null)).toBe(50)
    expect(clampLimit(undefined)).toBe(50)
  })

  it('honours a per-route default', () => {
    expect(clampLimit(null, { defaultLimit: 20 })).toBe(20)
  })

  it('accepts a valid in-range value', () => {
    expect(clampLimit('25')).toBe(25)
    expect(clampLimit('1')).toBe(1)
    expect(clampLimit('100')).toBe(100)
  })

  it('accepts leading zeros', () => {
    expect(clampLimit('025')).toBe(25)
  })

  it('clamps zero up to 1', () => {
    expect(clampLimit('0')).toBe(1)
    expect(clampLimit(0)).toBe(1)
  })

  it('clamps values above the maximum down to the maximum', () => {
    expect(clampLimit('101')).toBe(100)
    expect(clampLimit('100000000')).toBe(100)
    expect(clampLimit('999999999999999999999999')).toBe(100)
  })

  it('clamps a digit string long enough to coerce to Infinity', () => {
    expect(clampLimit('9'.repeat(400))).toBe(100)
  })

  it('rejects negatives and falls back to the default', () => {
    expect(clampLimit('-1')).toBe(50)
    expect(clampLimit('-100000')).toBe(50)
    expect(clampLimit(-1)).toBe(50)
  })

  it('rejects an empty string', () => {
    expect(clampLimit('')).toBe(50)
  })

  it('rejects non-numeric input', () => {
    expect(clampLimit('abc')).toBe(50)
    expect(clampLimit('null')).toBe(50)
  })

  it('rejects partially numeric input that parseInt would have accepted', () => {
    // parseInt('12abc') === 12 — the trap this helper exists to avoid.
    expect(Number.parseInt('12abc', 10)).toBe(12)
    expect(clampLimit('12abc')).toBe(50)
  })

  it('rejects floats', () => {
    expect(clampLimit('50.5')).toBe(50)
    expect(clampLimit('0.5')).toBe(50)
    expect(clampLimit(2.5)).toBe(50)
  })

  it('rejects exponent notation', () => {
    expect(clampLimit('1e9')).toBe(50)
    expect(clampLimit('1E9')).toBe(50)
  })

  it('rejects Infinity in every form', () => {
    expect(clampLimit('Infinity')).toBe(50)
    expect(clampLimit('-Infinity')).toBe(50)
    expect(clampLimit(Infinity)).toBe(50)
    expect(clampLimit(-Infinity)).toBe(50)
  })

  it('rejects NaN', () => {
    expect(clampLimit(NaN)).toBe(50)
    expect(clampLimit('NaN')).toBe(50)
  })

  it('rejects hex, octal and binary literals', () => {
    expect(clampLimit('0x64')).toBe(50)
    expect(clampLimit('0o144')).toBe(50)
    expect(clampLimit('0b101')).toBe(50)
  })

  it('rejects surrounding or embedded whitespace', () => {
    expect(clampLimit(' 12 ')).toBe(50)
    expect(clampLimit('1 2')).toBe(50)
    expect(clampLimit('\n12')).toBe(50)
  })

  it('rejects a leading plus sign', () => {
    expect(clampLimit('+12')).toBe(50)
  })

  it('rejects non-string, non-number types', () => {
    expect(clampLimit({})).toBe(50)
    expect(clampLimit([])).toBe(50)
    expect(clampLimit(['25'])).toBe(50)
    expect(clampLimit(true)).toBe(50)
    expect(clampLimit(() => 25)).toBe(50)
  })

  it('honours a per-route maximum', () => {
    expect(clampLimit('100', { maxLimit: 50 })).toBe(50)
    expect(clampLimit('40', { maxLimit: 50 })).toBe(40)
  })

  it('clamps a default that is itself above the maximum', () => {
    expect(clampLimit(null, { defaultLimit: 500, maxLimit: 100 })).toBe(100)
  })

  it('never returns NaN or a non-integer for any input', () => {
    const hostile: unknown[] = [
      null, undefined, '', ' ', 'abc', '12abc', '-1', '0', '1e9', 'Infinity',
      'NaN', '0x64', '50.5', NaN, Infinity, -0, {}, [], true, Symbol.iterator,
      '9'.repeat(400), '100000000', '-0',
    ]
    for (const value of hostile) {
      const result = clampLimit(value)
      expect(Number.isInteger(result), `limit for ${String(value)}`).toBe(true)
      expect(result).toBeGreaterThanOrEqual(1)
      expect(result).toBeLessThanOrEqual(MAX_LIMIT)
    }
  })
})

describe('clampPage', () => {
  it('defaults to 1', () => {
    expect(clampPage(null)).toBe(1)
    expect(clampPage(undefined)).toBe(1)
    expect(clampPage('')).toBe(1)
  })

  it('accepts a valid page', () => {
    expect(clampPage('3')).toBe(3)
    expect(clampPage(3)).toBe(3)
  })

  it('clamps zero and negatives up to 1', () => {
    expect(clampPage('0')).toBe(1)
    expect(clampPage('-5')).toBe(1)
  })

  it('rejects non-numeric input rather than producing NaN', () => {
    expect(clampPage('abc')).toBe(1)
    expect(clampPage('1e9')).toBe(1)
    expect(clampPage('2.5')).toBe(1)
    expect(clampPage(NaN)).toBe(1)
  })

  it('returns large-but-valid pages unchanged (parsePagination bounds them)', () => {
    expect(clampPage('999999999')).toBe(999999999)
  })

  it('never returns NaN for any input', () => {
    const hostile: unknown[] = [null, undefined, '', 'abc', '-1', '0', '1e9', NaN, {}, []]
    for (const value of hostile) {
      const result = clampPage(value)
      expect(Number.isInteger(result), `page for ${String(value)}`).toBe(true)
      expect(result).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('parsePagination', () => {
  it('returns defaults for an empty query string', () => {
    expect(parsePagination(params(''))).toEqual({ page: 1, limit: 50, skip: 0 })
  })

  it('honours a per-route default limit', () => {
    expect(parsePagination(params(''), { defaultLimit: 20 })).toEqual({
      page: 1,
      limit: 20,
      skip: 0,
    })
  })

  it('computes skip from page and limit', () => {
    expect(parsePagination(params('page=3&limit=20'))).toEqual({
      page: 3,
      limit: 20,
      skip: 40,
    })
  })

  it('clamps a hostile limit', () => {
    expect(parsePagination(params('limit=100000000')).limit).toBe(100)
  })

  it('rejects a negative limit and uses the default', () => {
    expect(parsePagination(params('limit=-1')).limit).toBe(50)
  })

  it('does not produce NaN skip for a non-numeric page', () => {
    const result = parsePagination(params('page=abc&limit=20'))
    expect(result).toEqual({ page: 1, limit: 20, skip: 0 })
    expect(Number.isNaN(result.skip)).toBe(false)
  })

  it('allows the largest offset that is exactly at the ceiling', () => {
    // page 101 with limit 100 → skip 10000 === MAX_OFFSET
    expect(parsePagination(params('page=101&limit=100')).skip).toBe(MAX_OFFSET)
  })

  it('throws OffsetTooLargeError one row past the ceiling', () => {
    expect(() => parsePagination(params('page=102&limit=100'))).toThrow(OffsetTooLargeError)
  })

  it('throws OffsetTooLargeError for an absurd page', () => {
    expect(() => parsePagination(params('page=999999999&limit=20'))).toThrow(OffsetTooLargeError)
  })

  it('throws for a page large enough to exceed Number.MAX_SAFE_INTEGER', () => {
    expect(() => parsePagination(params('page=99999999999999999999999'))).toThrow(
      OffsetTooLargeError,
    )
  })

  it('carries the ceiling on the thrown error', () => {
    try {
      parsePagination(params('page=999999'))
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(OffsetTooLargeError)
      expect((error as OffsetTooLargeError).maxOffset).toBe(MAX_OFFSET)
      expect((error as Error).name).toBe('OffsetTooLargeError')
      expect((error as Error).message).toContain('10000')
    }
  })

  it('honours a per-route offset ceiling', () => {
    expect(() => parsePagination(params('page=3&limit=50'), { maxOffset: 50 })).toThrow(
      OffsetTooLargeError,
    )
    expect(parsePagination(params('page=2&limit=50'), { maxOffset: 50 }).skip).toBe(50)
  })

  it('never yields a negative, NaN or unbounded take/skip for hostile input', () => {
    const hostile = [
      'limit=100000000',
      'limit=-1',
      'page=abc',
      'page=-1&limit=-1',
      'limit=0&page=0',
      'limit=1e9&page=1e9',
      'limit=Infinity&page=Infinity',
      'limit=NaN&page=NaN',
      'limit=50.5&page=2.5',
      'limit=12abc&page=12abc',
      'limit=%20100%20',
      'limit=&page=',
      'limit=100&limit=999999',
    ]
    for (const query of hostile) {
      const result = parsePagination(params(query))
      expect(Number.isInteger(result.limit), query).toBe(true)
      expect(Number.isInteger(result.skip), query).toBe(true)
      expect(result.limit).toBeGreaterThanOrEqual(1)
      expect(result.limit).toBeLessThanOrEqual(MAX_LIMIT)
      expect(result.skip).toBeGreaterThanOrEqual(0)
      expect(result.skip).toBeLessThanOrEqual(MAX_OFFSET)
    }
  })
})
