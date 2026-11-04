import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/db'
import { createOrgWithUser, createSecondOrg } from './helpers/auth'

type Status = 'pending' | 'active' | 'released' | 'failed'

const NUMBER = '+14155550100'

function insert(
  orgId: string,
  userId: string,
  over: { phoneNumber?: string; status?: Status; twilioSid?: string | null; deletedAt?: Date } = {},
) {
  return prisma.phoneInbox.create({
    data: {
      organizationId: orgId,
      userId,
      phoneNumber: over.phoneNumber ?? NUMBER,
      countryCode: 'US',
      status: over.status ?? 'active',
      twilioSid: over.twilioSid ?? null,
      deletedAt: over.deletedAt,
    },
  })
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise
    return undefined
  } catch (error) {
    return (error as { code?: string }).code
  }
}

describe('PhoneInbox live-number uniqueness', () => {
  it('rejects a second active row for the same number, even across organizations', async () => {
    const a = await createOrgWithUser()
    const b = await createSecondOrg()
    await insert(a.org.id, a.user.id)

    expect(await codeOf(insert(b.org.id, b.user.id))).toBe('P2002')
  })

  it('rejects an active row while a pending row holds the number', async () => {
    const a = await createOrgWithUser()
    const b = await createSecondOrg()
    await insert(a.org.id, a.user.id, { status: 'pending' })

    expect(await codeOf(insert(b.org.id, b.user.id, { status: 'active' }))).toBe('P2002')
  })

  it('allows the number to be re-bought once the earlier row is released', async () => {
    const a = await createOrgWithUser()
    const b = await createSecondOrg()
    await insert(a.org.id, a.user.id, { status: 'released' })

    expect(await codeOf(insert(b.org.id, b.user.id))).toBeUndefined()
  })

  it('does not let a failed row block a retry', async () => {
    const a = await createOrgWithUser()
    await insert(a.org.id, a.user.id, { status: 'failed' })

    expect(await codeOf(insert(a.org.id, a.user.id, { status: 'pending' }))).toBeUndefined()
  })

  it('allows many rows with no twilioSid', async () => {
    const a = await createOrgWithUser()
    await insert(a.org.id, a.user.id, { phoneNumber: '+14155550101', status: 'pending' })

    expect(
      await codeOf(insert(a.org.id, a.user.id, { phoneNumber: '+14155550102', status: 'pending' })),
    ).toBeUndefined()
  })

  it('keeps holding the number when only deletedAt is set — release must go through status', async () => {
    const a = await createOrgWithUser()
    const b = await createSecondOrg()
    await insert(a.org.id, a.user.id, { deletedAt: new Date() })

    expect(await codeOf(insert(b.org.id, b.user.id))).toBe('P2002')
  })

  it('rejects a reused twilioSid', async () => {
    const a = await createOrgWithUser()
    await insert(a.org.id, a.user.id, { phoneNumber: '+14155550103', twilioSid: 'PN' + 'a'.repeat(32) })

    expect(
      await codeOf(
        insert(a.org.id, a.user.id, { phoneNumber: '+14155550104', twilioSid: 'PN' + 'a'.repeat(32) }),
      ),
    ).toBe('P2002')
  })
})
