import { describe, expect, it } from 'vitest'
import { tagHandler, getHandlerTag } from '../route-tags'

describe('route tags', () => {
  it('returns null for an untagged function', () => {
    expect(getHandlerTag(() => {})).toBeNull()
  })

  it('returns null for non-functions', () => {
    expect(getHandlerTag(undefined)).toBeNull()
    expect(getHandlerTag(null as unknown)).toBeNull()
    expect(getHandlerTag({})).toBeNull()
  })

  it('round-trips a tag', () => {
    const handler = tagHandler(() => 'ok', 'user')
    expect(getHandlerTag(handler)).toBe('user')
  })

  it('returns the same function instance, not a wrapper', () => {
    const original = () => 'ok'
    expect(tagHandler(original, 'apiKey')).toBe(original)
  })

  it('does not expose the tag as an enumerable property', () => {
    const handler = tagHandler(() => 'ok', 'public')
    expect(Object.keys(handler)).toEqual([])
    expect(JSON.stringify({ handler })).toBe('{}')
  })

  it('tags survive being re-exported through another module binding', () => {
    const handler = tagHandler(() => 'ok', 'user')
    const rebound = handler
    expect(getHandlerTag(rebound)).toBe('user')
  })
})
