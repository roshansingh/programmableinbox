import { describe, expect, it } from 'vitest'
import {
  API_KEY_SCOPES,
  DEFAULT_API_KEY_SCOPES,
  API_KEY_SCOPE_SET,
  API_KEY_PREFIX,
} from '../api-key-scopes'

describe('api key scopes', () => {
  it('contains only read scopes', () => {
    expect([...API_KEY_SCOPES]).toEqual(['inboxes:read', 'messages:read'])
  })

  it('no longer offers messages:delete', () => {
    expect(API_KEY_SCOPE_SET.has('messages:delete')).toBe(false)
  })

  it('grants no write capability by default', () => {
    for (const scope of DEFAULT_API_KEY_SCOPES) {
      expect(scope.endsWith(':read')).toBe(true)
    }
  })

  it('exposes the live key prefix as a constant', () => {
    expect(API_KEY_PREFIX).toBe('sk_live_')
  })
})
