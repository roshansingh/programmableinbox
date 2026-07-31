import { describe, expect, it } from 'vitest'
import { toOrgScope, toOwnerScope } from '../scope'

const USER = {
  kind: 'user' as const,
  userId: 'user_1',
  email: 'user@example.com',
  memberships: [
    { organizationId: 'org_1', role: 'owner' },
    { organizationId: 'org_2', role: 'member' },
  ],
}

const KEY = {
  kind: 'apiKey' as const,
  apiKeyId: 'key_1',
  organizationId: 'org_1',
  scopes: ['inboxes:read'],
}

describe('toOrgScope', () => {
  it('gives a user every organization they belong to', () => {
    const result = toOrgScope(USER)
    expect(result.scope).toEqual({ organizationIds: ['org_1', 'org_2'] })
  })

  it('narrows a user to a requested organization they belong to', () => {
    const result = toOrgScope(USER, 'org_2')
    expect(result.scope).toEqual({ organizationIds: ['org_2'] })
  })

  it('403s a user requesting an organization they do not belong to', async () => {
    const result = toOrgScope(USER, 'org_other')
    expect(result.scope).toBeUndefined()
    expect(result.error?.status).toBe(403)
    expect(await result.error!.json()).toEqual({
      message: 'Not authorized for this organization',
    })
  })

  it('gives a key its bound organization', () => {
    const result = toOrgScope(KEY)
    expect(result.scope).toEqual({ organizationIds: ['org_1'] })
  })

  it('accepts a key requesting its own organization', () => {
    const result = toOrgScope(KEY, 'org_1')
    expect(result.scope).toEqual({ organizationIds: ['org_1'] })
  })

  it('403s a key requesting a different organization', () => {
    const result = toOrgScope(KEY, 'org_2')
    expect(result.error?.status).toBe(403)
  })

  it('treats null and undefined requested org as "no narrowing"', () => {
    expect(toOrgScope(USER, null).scope).toEqual({ organizationIds: ['org_1', 'org_2'] })
    expect(toOrgScope(USER, undefined).scope).toEqual({ organizationIds: ['org_1', 'org_2'] })
  })

  it('403s a user with no memberships at all', () => {
    const orphan = { ...USER, memberships: [] }
    expect(toOrgScope(orphan).error?.status).toBe(403)
  })
})

describe('toOwnerScope', () => {
  it('returns the user id', () => {
    expect(toOwnerScope(USER)).toEqual({ userId: 'user_1' })
  })
})
