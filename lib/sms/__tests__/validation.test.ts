import { describe, expect, it } from 'vitest'
import { isNanpNumber } from '../validation'

describe('isNanpNumber', () => {
  it.each(['+14155550100', '+12125550123', '+14165550100'])('accepts %s', (n) => {
    expect(isNanpNumber(n)).toBe(true)
  })

  it.each([
    ['another country', '+447700900123'],
    ['no plus', '14155550100'],
    ['too short', '+1415555010'],
    ['too long', '+141555501000'],
    ['area code starting 0', '+10155550100'],
    ['area code starting 1', '+11155550100'],
    ['exchange starting 0', '+14150550100'],
    ['exchange starting 1', '+14151550100'],
    ['formatting', '+1 (415) 555-0100'],
    ['not a string', 14155550100],
  ])('rejects %s', (_label, n) => {
    expect(isNanpNumber(n)).toBe(false)
  })
})
