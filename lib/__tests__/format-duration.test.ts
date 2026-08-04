import { describe, expect, it } from 'vitest'
import { formatDuration } from '../format-duration'

describe('formatDuration', () => {
  it('renders minutes below an hour', () => {
    expect(formatDuration(30)).toBe('30 minutes')
    expect(formatDuration(1)).toBe('1 minute')
  })

  it('renders exact hours as hours', () => {
    expect(formatDuration(60)).toBe('1 hour')
    expect(formatDuration(120)).toBe('2 hours')
  })

  it('renders exact days as days', () => {
    expect(formatDuration(1440)).toBe('1 day')
    expect(formatDuration(2880)).toBe('2 days')
  })

  it('falls back to minutes when the value divides evenly into nothing larger', () => {
    expect(formatDuration(90)).toBe('90 minutes')
  })
})
