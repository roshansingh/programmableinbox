import { describe, it, expect } from 'vitest'
import {
  getUserDisplayName,
  getUserInitials,
  defaultOrganizationName,
} from '@/lib/user-display'

describe('getUserDisplayName', () => {
  it('joins first and last name', () => {
    expect(getUserDisplayName({ firstName: 'Roshan', lastName: 'Singh', email: 'r@x.com' })).toBe('Roshan Singh')
  })

  it('falls back to whichever name is present', () => {
    expect(getUserDisplayName({ firstName: 'Roshan', email: 'r@x.com' })).toBe('Roshan')
    expect(getUserDisplayName({ lastName: 'Singh', email: 'r@x.com' })).toBe('Singh')
  })

  it('ignores whitespace-only names', () => {
    expect(getUserDisplayName({ firstName: '  ', lastName: '', email: 'roshan@x.com' })).toBe('roshan')
  })

  it('falls back to the email local part when no name is set', () => {
    expect(getUserDisplayName({ email: 'roshan@example.com' })).toBe('roshan')
  })

  it('returns an empty string with no user', () => {
    expect(getUserDisplayName(null)).toBe('')
    expect(getUserDisplayName(undefined)).toBe('')
  })
})

describe('getUserInitials', () => {
  it('uses first letters of first and last name', () => {
    expect(getUserInitials({ firstName: 'Roshan', lastName: 'Singh', email: 'r@x.com' })).toBe('RS')
  })

  it('uses the first two letters of a single name', () => {
    expect(getUserInitials({ firstName: 'Roshan', email: 'r@x.com' })).toBe('RO')
  })

  it('falls back to the email local part', () => {
    expect(getUserInitials({ email: 'roshan@example.com' })).toBe('RO')
  })

  it('handles a single-character local part', () => {
    expect(getUserInitials({ email: 'r@example.com' })).toBe('R')
  })

  it('returns an empty string with no user', () => {
    expect(getUserInitials(null)).toBe('')
  })
})

describe('defaultOrganizationName', () => {
  it('uses the full name of the registering user', () => {
    expect(defaultOrganizationName('Roshan', 'Singh', 'r@x.com')).toBe('Roshan Singh')
  })

  it('trims and collapses partial names', () => {
    expect(defaultOrganizationName('Roshan', null, 'r@x.com')).toBe('Roshan')
    expect(defaultOrganizationName(null, 'Singh', 'r@x.com')).toBe('Singh')
  })

  it('falls back to the email local part when no name was given', () => {
    expect(defaultOrganizationName(null, null, 'roshan@example.com')).toBe('roshan')
  })

  it('falls back to a generic name when nothing is usable', () => {
    expect(defaultOrganizationName(null, null, '@example.com')).toBe('My Organization')
  })
})
