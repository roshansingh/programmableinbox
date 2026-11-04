import { beforeEach, describe, expect, it, vi } from 'vitest'

const purchaseMock = vi.fn()
const releaseMock = vi.fn()
const findMock = vi.fn()
const availableMock = vi.fn()
vi.mock('@/lib/sms/numbers', () => ({
  purchaseNumber: (...args: unknown[]) => purchaseMock(...args),
  releaseNumber: (...args: unknown[]) => releaseMock(...args),
  findOwnedNumberSid: (...args: unknown[]) => findMock(...args),
  isNumberAvailable: (...args: unknown[]) => availableMock(...args),
}))

import { prisma } from '@/lib/db'
import { SmsProviderError } from '@/lib/sms/errors'
import {
  NumberUnavailableError,
  provisionPhoneInbox,
  releasePhoneInbox,
} from '@/lib/services/phone-provisioning'
import { createOrgWithUser, createSecondOrg } from './helpers/auth'

let counter = 0
function freshNumber() {
  counter += 1
  return `+1415556${String(counter).padStart(4, '0')}`
}

function sidFor(n: string) {
  return 'PN' + n.replace(/\D/g, '').padEnd(32, '0')
}

function purchased(phoneNumber: string) {
  return { sid: sidFor(phoneNumber), phoneNumber, capabilities: { sms: true, mms: false, voice: true } }
}

async function member() {
  const { org, user } = await createOrgWithUser()
  return { org, user, scope: { organizationId: org.id, userId: user.id } }
}

beforeEach(() => {
  vi.restoreAllMocks()
  purchaseMock.mockReset()
  releaseMock.mockReset()
  releaseMock.mockResolvedValue(undefined)
  findMock.mockReset()
  findMock.mockResolvedValue(null)
  availableMock.mockReset()
  availableMock.mockResolvedValue(true)
})

describe('provisionPhoneInbox', () => {
  it('leaves one active row carrying the Twilio sid and capabilities', async () => {
    const { org, user, scope } = await member()
    const number = freshNumber()
    purchaseMock.mockResolvedValue(purchased(number))

    const inbox = await provisionPhoneInbox(scope, { phoneNumber: number, countryCode: 'US' })

    expect(inbox).toMatchObject({
      organizationId: org.id,
      userId: user.id,
      phoneNumber: number,
      countryCode: 'US',
      status: 'active',
      twilioSid: sidFor(number),
      capabilities: { sms: true, mms: false, voice: true },
    })
  })

  it('rejects anything that is not E.164 before touching Twilio or the database', async () => {
    const { scope } = await member()

    await expect(
      provisionPhoneInbox(scope, { phoneNumber: '4155550100', countryCode: 'US' }),
    ).rejects.toBeInstanceOf(RangeError)
    expect(purchaseMock).not.toHaveBeenCalled()
  })

  it('lets exactly one of two concurrent requests for the same number buy it', async () => {
    const a = await member()
    const b = await member()
    const number = freshNumber()
    let release!: () => void
    purchaseMock.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve(purchased(number)))),
    )

    const first = provisionPhoneInbox(a.scope, { phoneNumber: number, countryCode: 'US' })
    // The first request has reserved the number (pending) and is waiting on Twilio.
    await vi.waitFor(async () => {
      expect(await prisma.phoneInbox.count({ where: { phoneNumber: number } })).toBe(1)
    })

    await expect(
      provisionPhoneInbox(b.scope, { phoneNumber: number, countryCode: 'US' }),
    ).rejects.toBeInstanceOf(NumberUnavailableError)

    release()
    await expect(first).resolves.toMatchObject({ status: 'active' })
    expect(purchaseMock).toHaveBeenCalledTimes(1)
  })

  it('marks the row failed and reports the number gone when Twilio refuses it', async () => {
    const { scope } = await member()
    const number = freshNumber()
    purchaseMock.mockRejectedValue(new SmsProviderError('not available', 'invalid-request', 400, 21422))

    await expect(
      provisionPhoneInbox(scope, { phoneNumber: number, countryCode: 'US' }),
    ).rejects.toBeInstanceOf(NumberUnavailableError)

    const rows = await prisma.phoneInbox.findMany({ where: { phoneNumber: number } })
    expect(rows.map((r) => r.status)).toEqual(['failed'])
  })

  it('lets the same number be bought again after a failed attempt', async () => {
    const { scope } = await member()
    const number = freshNumber()
    purchaseMock.mockRejectedValueOnce(new SmsProviderError('down', 'unavailable', 503, null))
    await expect(
      provisionPhoneInbox(scope, { phoneNumber: number, countryCode: 'US' }),
    ).rejects.toMatchObject({ kind: 'unavailable' })

    purchaseMock.mockResolvedValueOnce(purchased(number))
    await expect(
      provisionPhoneInbox(scope, { phoneNumber: number, countryCode: 'US' }),
    ).resolves.toMatchObject({ status: 'active' })
  })

  it('rethrows a provider outage unchanged and leaves the row failed', async () => {
    const { scope } = await member()
    const number = freshNumber()
    purchaseMock.mockRejectedValue(new SmsProviderError('down', 'unavailable', 503, null))

    await expect(
      provisionPhoneInbox(scope, { phoneNumber: number, countryCode: 'US' }),
    ).rejects.toMatchObject({ kind: 'unavailable' })

    const row = await prisma.phoneInbox.findFirstOrThrow({ where: { phoneNumber: number } })
    expect(row.status).toBe('failed')
  })

  it('gives the number back to Twilio when the database cannot record the purchase', async () => {
    const { scope } = await member()
    const number = freshNumber()
    purchaseMock.mockResolvedValue(purchased(number))
    const realUpdate = prisma.phoneInbox.updateMany.bind(prisma.phoneInbox)
    vi.spyOn(prisma.phoneInbox, 'updateMany').mockImplementation(((args: { data: { status?: string } }) => {
      if (args.data.status === 'active') return Promise.reject(new Error('connection lost'))
      return realUpdate(args as never)
    }) as never)

    await expect(
      provisionPhoneInbox(scope, { phoneNumber: number, countryCode: 'US' }),
    ).rejects.toThrow('connection lost')

    expect(releaseMock).toHaveBeenCalledWith(sidFor(number))
    const row = await prisma.phoneInbox.findFirstOrThrow({ where: { phoneNumber: number } })
    expect(row.status).toBe('failed')
  })

  it('keeps the reservation pending, still locking the number, if that compensating release also fails', async () => {
    const { scope } = await member()
    const number = freshNumber()
    purchaseMock.mockResolvedValue(purchased(number))
    releaseMock.mockRejectedValue(new SmsProviderError('down', 'unavailable', 503, null))
    const realUpdate = prisma.phoneInbox.updateMany.bind(prisma.phoneInbox)
    vi.spyOn(prisma.phoneInbox, 'updateMany').mockImplementation(((args: { data: { status?: string } }) => {
      if (args.data.status === 'active') return Promise.reject(new Error('connection lost'))
      return realUpdate(args as never)
    }) as never)

    await expect(
      provisionPhoneInbox(scope, { phoneNumber: number, countryCode: 'US' }),
    ).rejects.toThrow('connection lost')

    // A paid number we could not give back must stay visible and recoverable,
    // not be hidden behind `failed` with its lock dropped.
    const row = await prisma.phoneInbox.findFirstOrThrow({ where: { phoneNumber: number } })
    expect(row.status).toBe('pending')
    const rival = await member()
    await expect(
      provisionPhoneInbox(rival.scope, { phoneNumber: number, countryCode: 'US' }),
    ).rejects.toBeInstanceOf(NumberUnavailableError)
  })

  it('releases a number Twilio sold us even though the purchase answer was lost', async () => {
    const { scope } = await member()
    const number = freshNumber()
    purchaseMock.mockRejectedValue(new SmsProviderError('timed out', 'unavailable', null, null))
    findMock.mockResolvedValue(sidFor(number))

    await expect(
      provisionPhoneInbox(scope, { phoneNumber: number, countryCode: 'US' }),
    ).rejects.toMatchObject({ kind: 'unavailable' })

    expect(findMock).toHaveBeenCalledWith(number)
    expect(releaseMock).toHaveBeenCalledWith(sidFor(number))
    const row = await prisma.phoneInbox.findFirstOrThrow({ where: { phoneNumber: number } })
    expect(row.status).toBe('failed')
  })

  it('does not look for a stray number after a refusal that proves nothing was bought', async () => {
    const { scope } = await member()
    purchaseMock.mockRejectedValue(new SmsProviderError('bad creds', 'auth', 401, 20003))

    await expect(
      provisionPhoneInbox(scope, { phoneNumber: freshNumber(), countryCode: 'US' }),
    ).rejects.toMatchObject({ kind: 'auth' })

    expect(findMock).not.toHaveBeenCalled()
  })

  it('keeps the reservation pending and reports the original error if the stray-number check itself fails', async () => {
    const { scope } = await member()
    const number = freshNumber()
    purchaseMock.mockRejectedValue(new SmsProviderError('timed out', 'unavailable', null, null))
    findMock.mockRejectedValue(new SmsProviderError('still down', 'unavailable', 503, null))

    await expect(
      provisionPhoneInbox(scope, { phoneNumber: number, countryCode: 'US' }),
    ).rejects.toMatchObject({ message: 'timed out' })

    const row = await prisma.phoneInbox.findFirstOrThrow({ where: { phoneNumber: number } })
    expect(row.status).toBe('pending')
  })

  it('gives the number back if the reservation was cleared while Twilio was selling it', async () => {
    const { scope } = await member()
    const number = freshNumber()
    purchaseMock.mockImplementation(async () => {
      // The creator cleared the stuck reservation mid-purchase.
      await prisma.phoneInbox.updateMany({ where: { phoneNumber: number }, data: { status: 'failed' } })
      return purchased(number)
    })

    await expect(
      provisionPhoneInbox(scope, { phoneNumber: number, countryCode: 'US' }),
    ).rejects.toThrow(/cancelled/i)

    expect(releaseMock).toHaveBeenCalledWith(sidFor(number))
    const row = await prisma.phoneInbox.findFirstOrThrow({ where: { phoneNumber: number } })
    expect(row.status).toBe('failed')
  })

  it('gives the number back if a cleanup claimed the reservation while Twilio was selling it', async () => {
    const { scope } = await member()
    const number = freshNumber()
    purchaseMock.mockImplementation(async () => {
      // A cleanup took the lease: the row is still pending but no longer ours.
      await prisma.phoneInbox.updateMany({
        where: { phoneNumber: number },
        data: { updatedAt: new Date(Date.now() + 60_000) },
      })
      return purchased(number)
    })

    await expect(
      provisionPhoneInbox(scope, { phoneNumber: number, countryCode: 'US' }),
    ).rejects.toThrow(/cancelled/i)

    expect(releaseMock).toHaveBeenCalledWith(sidFor(number))
  })

  it('rejects a number outside North America before touching Twilio or the database', async () => {
    const { scope } = await member()

    await expect(
      provisionPhoneInbox(scope, { phoneNumber: '+447700900123', countryCode: 'US' }),
    ).rejects.toBeInstanceOf(RangeError)
    expect(purchaseMock).not.toHaveBeenCalled()
  })

  it('refuses a syntactically valid number the local inventory does not offer, without reserving it', async () => {
    const { scope } = await member()
    const number = '+18005550100' // toll-free: NANP-shaped, never in the local inventory
    availableMock.mockResolvedValue(false)

    await expect(
      provisionPhoneInbox(scope, { phoneNumber: number, countryCode: 'US' }),
    ).rejects.toBeInstanceOf(NumberUnavailableError)

    expect(availableMock).toHaveBeenCalledWith('US', number)
    expect(purchaseMock).not.toHaveBeenCalled()
    expect(await prisma.phoneInbox.count({ where: { phoneNumber: number } })).toBe(0)
  })
})

describe('releasePhoneInbox', () => {
  async function active() {
    const m = await member()
    const number = freshNumber()
    purchaseMock.mockResolvedValue(purchased(number))
    const inbox = await provisionPhoneInbox(m.scope, { phoneNumber: number, countryCode: 'US' })
    return { ...m, inbox, number }
  }

  it('releases at Twilio first, then marks the row released and soft-deleted together', async () => {
    const { user, inbox, number } = await active()

    await expect(releasePhoneInbox({ userId: user.id }, inbox.id)).resolves.toBe('released')

    expect(releaseMock).toHaveBeenCalledWith(sidFor(number))
    const row = await prisma.phoneInbox.findFirstOrThrow({
      where: { id: inbox.id, deletedAt: { not: null } },
    })
    expect(row.status).toBe('released')
    expect(row.releasedAt).not.toBeNull()
  })

  it('frees the number for another organization once released', async () => {
    const { user, inbox, number } = await active()
    await releasePhoneInbox({ userId: user.id }, inbox.id)

    const other = await member()
    // Twilio issues a fresh sid for every purchase, even of a number it sold before.
    purchaseMock.mockResolvedValue({ ...purchased(number), sid: 'PN' + 'f'.repeat(32) })
    await expect(
      provisionPhoneInbox(other.scope, { phoneNumber: number, countryCode: 'US' }),
    ).resolves.toMatchObject({ status: 'active' })
  })

  it('keeps the row active and still holding the number when Twilio will not release it', async () => {
    const { user, inbox, number } = await active()
    releaseMock.mockRejectedValue(new SmsProviderError('down', 'unavailable', 503, null))

    await expect(releasePhoneInbox({ userId: user.id }, inbox.id)).rejects.toMatchObject({
      kind: 'unavailable',
    })

    const row = await prisma.phoneInbox.findUniqueOrThrow({ where: { id: inbox.id } })
    expect(row.status).toBe('active')
    expect(row.deletedAt).toBeNull()
    const rival = await member()
    await expect(
      provisionPhoneInbox(rival.scope, { phoneNumber: number, countryCode: 'US' }),
    ).rejects.toBeInstanceOf(NumberUnavailableError)
  })

  it('is not-found for anyone but the creator, and never calls Twilio', async () => {
    const { inbox } = await active()
    const teammate = await createSecondOrg()

    await expect(releasePhoneInbox({ userId: teammate.user.id }, inbox.id)).resolves.toBe('not-found')
    expect(releaseMock).not.toHaveBeenCalled()
  })

  async function stalePending() {
    const m = await member()
    const number = freshNumber()
    const row = await prisma.phoneInbox.create({
      data: {
        organizationId: m.org.id,
        userId: m.user.id,
        phoneNumber: number,
        countryCode: 'US',
        status: 'pending',
      },
    })
    await prisma.$executeRaw`UPDATE "phone_inboxes" SET "createdAt" = now() - interval '10 minutes', "updatedAt" = now() - interval '10 minutes' WHERE id = ${row.id}::uuid`
    return { ...m, row, number }
  }

  it('lets the creator clear a reservation that has been stuck pending', async () => {
    const { user, row, number } = await stalePending()
    findMock.mockResolvedValue(sidFor(number))

    await expect(releasePhoneInbox({ userId: user.id }, row.id)).resolves.toBe('released')

    expect(releaseMock).toHaveBeenCalledWith(sidFor(number))
    const after = await prisma.phoneInbox.findFirstOrThrow({
      where: { id: row.id, deletedAt: { not: null } },
    })
    expect(after.status).toBe('failed')
  })

  it('frees the number and the plan slot when the stuck reservation never bought anything', async () => {
    const { user, row, number } = await stalePending()

    await expect(releasePhoneInbox({ userId: user.id }, row.id)).resolves.toBe('released')

    expect(releaseMock).not.toHaveBeenCalled()
    const other = await member()
    purchaseMock.mockResolvedValue({ ...purchased(number), sid: 'PN' + 'e'.repeat(32) })
    await expect(
      provisionPhoneInbox(other.scope, { phoneNumber: number, countryCode: 'US' }),
    ).resolves.toMatchObject({ status: 'active' })
  })

  it('lets only one of two concurrent clean-ups of a stuck reservation reach Twilio', async () => {
    const { user, row, number } = await stalePending()
    findMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return sidFor(number)
    })

    const outcomes = await Promise.all([
      releasePhoneInbox({ userId: user.id }, row.id),
      releasePhoneInbox({ userId: user.id }, row.id),
    ])

    expect([...outcomes].sort()).toEqual(['not-found', 'released'])
    expect(releaseMock).toHaveBeenCalledTimes(1)
  })

  it('leaves a recent pending reservation alone, since a purchase may still be in flight', async () => {
    const m = await member()
    const row = await prisma.phoneInbox.create({
      data: {
        organizationId: m.org.id,
        userId: m.user.id,
        phoneNumber: freshNumber(),
        countryCode: 'US',
        status: 'pending',
      },
    })

    await expect(releasePhoneInbox({ userId: m.user.id }, row.id)).resolves.toBe('not-found')
    expect((await prisma.phoneInbox.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('pending')
  })

  it('is not-found for a creator who has since left the organization, and releases nothing', async () => {
    const { user, org, inbox } = await active()
    await prisma.membership.deleteMany({ where: { userId: user.id, organizationId: org.id } })
    releaseMock.mockClear()

    await expect(releasePhoneInbox({ userId: user.id }, inbox.id)).resolves.toBe('not-found')
    expect(releaseMock).not.toHaveBeenCalled()
  })

  it('is not-found for a number that is not active', async () => {
    const { user, inbox } = await active()
    await releasePhoneInbox({ userId: user.id }, inbox.id)
    releaseMock.mockClear()

    await expect(releasePhoneInbox({ userId: user.id }, inbox.id)).resolves.toBe('not-found')
    expect(releaseMock).not.toHaveBeenCalled()
  })
})
