import { describe, expect, it } from 'vitest'
import { toOrgScope, toOwnerScope, toInboxWriteScope } from '../scope'

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
  userId: 'key_owner',
  scopes: ['email_inboxes:read'],
}

const KEY_WITH_WRITE = { ...KEY, scopes: ['email_inboxes:write'] }

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

describe('toInboxWriteScope', () => {
  it('gives a user the organization they asked for and their own id', () => {
    const result = toInboxWriteScope(USER, 'org_2')
    expect(result.scope).toEqual({ organizationId: 'org_2', userId: 'user_1' })
  })

  it('403s a user writing into an organization they do not belong to', async () => {
    const result = toInboxWriteScope(USER, 'org_other')
    expect(result.scope).toBeUndefined()
    expect(result.error?.status).toBe(403)
    expect(await result.error!.json()).toEqual({
      message: 'Not authorized for this organization',
    })
  })

  it('403s a user who belongs to no organization', () => {
    const orphan = { ...USER, memberships: [] }
    expect(toInboxWriteScope(orphan, 'org_1').error?.status).toBe(403)
  })

  it('attributes a key write to the user who minted the key', () => {
    // EmailInbox.userId is NOT NULL and a key is not a person, so the created
    // row is owned by the human who issued the credential.
    const result = toInboxWriteScope(KEY_WITH_WRITE)
    expect(result.scope).toEqual({ organizationId: 'org_1', userId: 'key_owner' })
  })

  it('accepts a key naming its own organization', () => {
    const result = toInboxWriteScope(KEY_WITH_WRITE, 'org_1')
    expect(result.scope).toEqual({ organizationId: 'org_1', userId: 'key_owner' })
  })

  it('403s a key naming a different organization', () => {
    expect(toInboxWriteScope(KEY_WITH_WRITE, 'org_2').error?.status).toBe(403)
  })

  it('constrains an unnamed-organization user write to the creator alone', () => {
    // What a dashboard PATCH uses. Exactly the authority `OwnerScope` gave
    // before, so updating an inbox from the UI is unchanged. `createInbox`
    // refuses a null organization separately — it has to know where to put the
    // row, and a user may belong to several.
    const result = toInboxWriteScope(USER)
    expect(result.scope).toEqual({ organizationId: null, userId: 'user_1' })
  })

  it('never gives a key a null organization, whatever its minter belongs to', () => {
    // A key issued for org_1 whose minter also belongs to org_2 must not be
    // able to write into org_2. Constraining by userId alone would allow it.
    const result = toInboxWriteScope(KEY_WITH_WRITE)
    expect(result.scope?.organizationId).toBe('org_1')
  })
})
