import { describe, it, expect } from 'vitest'
import { encodeCursor, decodeCursor, InvalidCursorError } from '../cursor'

describe('cursor codec', () => {
  it('round-trips createdAt (ms precision) and id', () => {
    const createdAt = new Date('2026-07-13T12:00:00.123Z')
    const token = encodeCursor({ createdAt, id: 'msg_1' })
    const decoded = decodeCursor(token)
    expect(decoded.id).toBe('msg_1')
    expect(decoded.epochMs).toBe(createdAt.getTime())
    expect(decoded.createdAt.getTime()).toBe(createdAt.getTime())
  })

  it('accepts a string createdAt on encode', () => {
    const token = encodeCursor({ createdAt: '2026-07-13T12:00:00.000Z', id: 'x' })
    expect(decodeCursor(token).id).toBe('x')
  })

  it('preserves ids containing a pipe character', () => {
    const createdAt = new Date('2026-07-13T00:00:00.000Z')
    const decoded = decodeCursor(encodeCursor({ createdAt, id: 'a|b|c' }))
    expect(decoded.id).toBe('a|b|c')
  })

  it('throws InvalidCursorError on garbage', () => {
    expect(() => decodeCursor('not-a-real-cursor')).toThrow(InvalidCursorError)
  })

  it('throws InvalidCursorError when epoch is non-numeric', () => {
    const token = Buffer.from('abc|msg_1', 'utf8').toString('base64url')
    expect(() => decodeCursor(token)).toThrow(InvalidCursorError)
  })

  it('throws InvalidCursorError when the epoch segment is empty', () => {
    const token = Buffer.from('|msg_1', 'utf8').toString('base64url')
    expect(() => decodeCursor(token)).toThrow(InvalidCursorError)
  })

  it('throws InvalidCursorError when epoch exceeds the safe integer range', () => {
    const token = Buffer.from('100000000000000000000|msg_1', 'utf8').toString('base64url')
    expect(() => decodeCursor(token)).toThrow(InvalidCursorError)
  })

  // 8.64e15 is the largest instant Date can represent; one past it is still a
  // safe integer, so a safe-integer check alone would let it through.
  it('throws InvalidCursorError when epoch is outside the valid Date range', () => {
    const token = Buffer.from('8640000000000001|msg_1', 'utf8').toString('base64url')
    expect(() => decodeCursor(token)).toThrow(InvalidCursorError)
  })

  it('accepts the boundary epoch that Date can still represent', () => {
    const token = Buffer.from('8640000000000000|msg_1', 'utf8').toString('base64url')
    expect(decodeCursor(token).epochMs).toBe(8640000000000000)
  })

  it('throws InvalidCursorError on exponent notation', () => {
    const token = Buffer.from('1e12|msg_1', 'utf8').toString('base64url')
    expect(() => decodeCursor(token)).toThrow(InvalidCursorError)
  })

  it('throws InvalidCursorError when the epoch segment is padded with whitespace', () => {
    const token = Buffer.from(' 12 |msg_1', 'utf8').toString('base64url')
    expect(() => decodeCursor(token)).toThrow(InvalidCursorError)
  })

  it('never decodes to an Invalid Date', () => {
    for (const epoch of ['100000000000000000000', '8640000000000001', 'NaN', 'Infinity']) {
      const token = Buffer.from(`${epoch}|msg_1`, 'utf8').toString('base64url')
      expect(() => decodeCursor(token)).toThrow(InvalidCursorError)
    }
  })
})
