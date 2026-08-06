import { describe, expect, it } from 'vitest'
import {
  API_KEY_SCOPES,
  DEFAULT_API_KEY_SCOPES,
  API_KEY_SCOPE_SET,
  API_KEY_PREFIX,
  LEGACY_SCOPE_ALIASES,
  resolveScope,
} from '../api-key-scopes'

describe('api key scopes', () => {
  it('names the domain in every scope', () => {
    expect([...API_KEY_SCOPES]).toEqual([
      'email_inboxes:read',
      'email_messages:read',
      'email_inboxes:write',
    ])
  })

  it('no longer offers messages:delete', () => {
    expect(API_KEY_SCOPE_SET.has('messages:delete')).toBe(false)
  })

  it('does not accept the unprefixed scopes as valid values', () => {
    expect(API_KEY_SCOPE_SET.has('inboxes:read')).toBe(false)
    expect(API_KEY_SCOPE_SET.has('messages:read')).toBe(false)
  })

  it('grants no write capability by default', () => {
    for (const scope of DEFAULT_API_KEY_SCOPES) {
      expect(scope.endsWith(':read')).toBe(true)
    }
    expect(DEFAULT_API_KEY_SCOPES).not.toContain('email_inboxes:write')
  })

  it('exposes the live key prefix as a constant', () => {
    expect(API_KEY_PREFIX).toBe('sk_live_')
  })
})

describe('legacy scope aliases', () => {
  it('maps every retired name onto its replacement', () => {
    expect(LEGACY_SCOPE_ALIASES).toEqual({
      'inboxes:read': 'email_inboxes:read',
      'messages:read': 'email_messages:read',
    })
  })

  it('grants no alias onto the write scope', () => {
    expect(Object.values(LEGACY_SCOPE_ALIASES)).not.toContain('email_inboxes:write')
  })

  it('resolves a stored legacy scope to its current name', () => {
    expect(resolveScope('inboxes:read')).toBe('email_inboxes:read')
    expect(resolveScope('messages:read')).toBe('email_messages:read')
  })

  it('passes a current scope through unchanged', () => {
    expect(resolveScope('email_inboxes:write')).toBe('email_inboxes:write')
  })

  it('leaves an unrecognized scope alone rather than inventing one', () => {
    expect(resolveScope('messages:delete')).toBe('messages:delete')
  })
})
