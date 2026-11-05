import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/db'
import { createOrgWithUser } from './helpers/auth'

async function inbox(orgId: string, userId: string, phoneNumber: string) {
  return prisma.phoneInbox.create({
    data: { organizationId: orgId, userId, phoneNumber, countryCode: 'US', status: 'active' },
  })
}

function message(
  inboxRow: { id: string; organizationId: string },
  over: { externalId?: string; from?: string } = {},
) {
  const from = over.from ?? '+14155550199'
  return prisma.phoneMessage.create({
    data: {
      phoneInboxId: inboxRow.id,
      organizationId: inboxRow.organizationId,
      from,
      to: '+14155550100',
      body: 'Your code is 123456',
      externalId: over.externalId ?? 'SM' + 'a'.repeat(32),
      threadId: `${inboxRow.id}:${from}`,
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

describe('PhoneMessage', () => {
  it('defaults mediaCount to 0 and extractedOtp to null', async () => {
    const a = await createOrgWithUser()
    const row = await message(await inbox(a.org.id, a.user.id, '+14155550100'))

    expect(row.mediaCount).toBe(0)
    expect(row.extractedOtp).toBeNull()
  })

  it('rejects a second delivery of the same externalId to the same inbox', async () => {
    const a = await createOrgWithUser()
    const box = await inbox(a.org.id, a.user.id, '+14155550100')
    await message(box)

    expect(await codeOf(message(box))).toBe('P2002')
  })

  // MessageSid is globally unique at Twilio, and signatures carry no timestamp, so
  // a re-sent or replayed delivery can arrive after the number has changed hands.
  // Uniqueness per inbox would store it a second time, in the new holder's inbox.
  it('rejects the same externalId on a different inbox', async () => {
    const a = await createOrgWithUser()
    const one = await inbox(a.org.id, a.user.id, '+14155550100')
    const two = await inbox(a.org.id, a.user.id, '+14155550101')
    await message(one)

    expect(await codeOf(message(two))).toBe('P2002')
  })

  it('is removed with its inbox', async () => {
    const a = await createOrgWithUser()
    const box = await inbox(a.org.id, a.user.id, '+14155550100')
    await message(box)

    await prisma.phoneInbox.delete({ where: { id: box.id } })

    expect(await prisma.phoneMessage.count()).toBe(0)
  })
})
