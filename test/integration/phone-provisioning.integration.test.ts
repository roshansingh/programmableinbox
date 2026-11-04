import { beforeEach, describe, expect, it, vi } from 'vitest'

const purchaseMock = vi.fn()
const releaseMock = vi.fn()
vi.mock('@/lib/sms/numbers', () => ({
  purchaseNumber: (...args: unknown[]) => purchaseMock(...args),
  releaseNumber: (...args: unknown[]) => releaseMock(...args),
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
    const realUpdate = prisma.phoneInbox.update.bind(prisma.phoneInbox)
    vi.spyOn(prisma.phoneInbox, 'update').mockImplementation(((args: { data: { status?: string } }) => {
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

  it('still marks the row failed if that compensating release also fails', async () => {
    const { scope } = await member()
    const number = freshNumber()
    purchaseMock.mockResolvedValue(purchased(number))
    releaseMock.mockRejectedValue(new SmsProviderError('down', 'unavailable', 503, null))
    const realUpdate = prisma.phoneInbox.update.bind(prisma.phoneInbox)
    vi.spyOn(prisma.phoneInbox, 'update').mockImplementation(((args: { data: { status?: string } }) => {
      if (args.data.status === 'active') return Promise.reject(new Error('connection lost'))
      return realUpdate(args as never)
    }) as never)

    await expect(
      provisionPhoneInbox(scope, { phoneNumber: number, countryCode: 'US' }),
    ).rejects.toThrow('connection lost')

    const row = await prisma.phoneInbox.findFirstOrThrow({ where: { phoneNumber: number } })
    expect(row.status).toBe('failed')
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

  it('is not-found for a number that is not active', async () => {
    const { user, inbox } = await active()
    await releasePhoneInbox({ userId: user.id }, inbox.id)
    releaseMock.mockClear()

    await expect(releasePhoneInbox({ userId: user.id }, inbox.id)).resolves.toBe('not-found')
    expect(releaseMock).not.toHaveBeenCalled()
  })
})
