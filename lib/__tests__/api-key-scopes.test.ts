import { describe, expect, it } from 'vitest'
import {
  API_KEY_SCOPES,
  DEFAULT_API_KEY_SCOPES,
  API_KEY_SCOPE_SET,
  API_KEY_PREFIX,
  API_KEY_SCOPE_DESCRIPTIONS,
  IMPLIED_IN_UI,
  LEGACY_SCOPE_ALIASES,
  resolveScope,
} from '../api-key-scopes'

describe('api key scopes', () => {
  it('names the domain in every scope', () => {
    expect([...API_KEY_SCOPES]).toEqual([
      'email_inboxes:read',
      'email_messages:read',
      'email_inboxes:create',
      'email_inboxes:update',
      'email_inboxes:delete',
    ])
  })

  it('offers no coarse write scope that bundles the three', () => {
    // Create, update and delete differ in what they cost to get wrong. Delete
    // permanently consumes an address; the other two do not. A single `write`
    // would make the cheapest grant carry the most expensive capability.
    expect(API_KEY_SCOPE_SET.has('email_inboxes:write')).toBe(false)
  })

  it('no longer offers messages:delete', () => {
    expect(API_KEY_SCOPE_SET.has('messages:delete')).toBe(false)
  })

  it('does not accept the unprefixed scopes as valid values', () => {
    expect(API_KEY_SCOPE_SET.has('inboxes:read')).toBe(false)
    expect(API_KEY_SCOPE_SET.has('messages:read')).toBe(false)
  })

  it('grants no mutating capability by default', () => {
    for (const scope of DEFAULT_API_KEY_SCOPES) {
      expect(scope.endsWith(':read')).toBe(true)
    }
  })

  it('describes every scope, including each mutating one separately', () => {
    for (const scope of API_KEY_SCOPES) {
      expect(API_KEY_SCOPE_DESCRIPTIONS[scope]).toBeTruthy()
    }
    // The delete description has to say the part that cannot be undone.
    expect(API_KEY_SCOPE_DESCRIPTIONS['email_inboxes:delete']).toMatch(/address/i)
  })

  it('pairs every mutating scope with inbox read in the dashboard', () => {
    // A key that can create an inbox but cannot list what it created is a
    // strange object, and scopes are fixed at creation.
    for (const scope of ['email_inboxes:create', 'email_inboxes:update', 'email_inboxes:delete'] as const) {
      expect(IMPLIED_IN_UI[scope]).toEqual(['email_inboxes:read'])
    }
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

  it('grants no alias onto any mutating scope', () => {
    // A rename must never be a privilege grant.
    for (const target of Object.values(LEGACY_SCOPE_ALIASES)) {
      expect(target.endsWith(':read')).toBe(true)
    }
  })

  it('resolves a stored legacy scope to its current name', () => {
    expect(resolveScope('inboxes:read')).toBe('email_inboxes:read')
    expect(resolveScope('messages:read')).toBe('email_messages:read')
  })

  it('passes a current scope through unchanged', () => {
    expect(resolveScope('email_inboxes:delete')).toBe('email_inboxes:delete')
  })

  it('leaves an unrecognized scope alone rather than inventing one', () => {
    expect(resolveScope('messages:delete')).toBe('messages:delete')
  })
})
