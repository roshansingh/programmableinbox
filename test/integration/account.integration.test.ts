import { describe, it, expect } from 'vitest'
import bcrypt from 'bcryptjs'
import { PATCH as patchOrganization } from '@/app/api/v1/account/organization/route'
import { PATCH as patchPassword } from '@/app/api/v1/account/password/route'
import { prisma } from '@/lib/db'
import { createOrgWithUser, createSecondOrg } from './helpers/auth'
import { jsonRequest } from './helpers/request'

describe('PATCH /api/v1/account/organization', () => {
  it('401 without a token', async () => {
    const res = await patchOrganization(jsonRequest('http://localhost/api/v1/account/organization', {
      method: 'PATCH',
      body: { organizationId: 'does-not-matter', name: 'New Name' },
    }))
    expect(res.status).toBe(401)
    const { message } = await res.json()
    expect(message).toBe('Unauthorized')
  })

  it('renames the caller\'s own org and persists the new name', async () => {
    const { org, token } = await createOrgWithUser()
    const res = await patchOrganization(jsonRequest('http://localhost/api/v1/account/organization', {
      method: 'PATCH',
      credential: token,
      body: { organizationId: org.id, name: 'Renamed Org' },
    }))
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.name).toBe('Renamed Org')

    const row = await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })
    expect(row.name).toBe('Renamed Org')
  })

  it('403 renaming an org the caller does not belong to', async () => {
    const { token } = await createOrgWithUser()
    const other = await createSecondOrg()
    const res = await patchOrganization(jsonRequest('http://localhost/api/v1/account/organization', {
      method: 'PATCH',
      credential: token,
      body: { organizationId: other.org.id, name: 'Hijacked Name' },
    }))
    expect(res.status).toBe(403)
    const { message } = await res.json()
    expect(message).toBe('Forbidden')

    const row = await prisma.organization.findUniqueOrThrow({ where: { id: other.org.id } })
    expect(row.name).not.toBe('Hijacked Name')
  })
})

describe('PATCH /api/v1/account/password', () => {
  it('401 without a token', async () => {
    const res = await patchPassword(jsonRequest('http://localhost/api/v1/account/password', {
      method: 'PATCH',
      body: { currentPassword: 'password123', newPassword: 'newpassword123' },
    }))
    expect(res.status).toBe(401)
    const { message } = await res.json()
    expect(message).toBe('Unauthorized')
  })

  it('changes the password with the correct current password and stores a hash that verifies', async () => {
    const { user, token } = await createOrgWithUser()
    const res = await patchPassword(jsonRequest('http://localhost/api/v1/account/password', {
      method: 'PATCH',
      credential: token,
      body: { currentPassword: 'password123', newPassword: 'newpassword123' },
    }))
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.message).toBe('Password updated')

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(row.passwordHash).not.toBe(user.passwordHash)
    await expect(bcrypt.compare('newpassword123', row.passwordHash)).resolves.toBe(true)
    await expect(bcrypt.compare('password123', row.passwordHash)).resolves.toBe(false)
  })

  it('401 with the wrong current password, leaving the hash unchanged', async () => {
    const { user, token } = await createOrgWithUser()
    const res = await patchPassword(jsonRequest('http://localhost/api/v1/account/password', {
      method: 'PATCH',
      credential: token,
      body: { currentPassword: 'wrong-password', newPassword: 'newpassword123' },
    }))
    expect(res.status).toBe(401)
    const { message } = await res.json()
    expect(message).toBe('Current password is incorrect')

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(row.passwordHash).toBe(user.passwordHash)
  })
})
