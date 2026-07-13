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
})
