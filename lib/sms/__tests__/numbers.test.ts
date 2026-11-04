import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SmsProviderError } from '../errors'

const listMock = vi.fn()
const createMock = vi.fn()
const removeMock = vi.fn()
const findMock = vi.fn()
const availableMock = vi.fn((_country: string) => ({ local: { list: listMock } }))

// `callTwilio` is the seam: the real one maps SDK failures into SmsProviderError,
// so these tests throw SmsProviderError directly, exactly as it would.
const fakeClient = {
  availablePhoneNumbers: (country: string) => availableMock(country),
  incomingPhoneNumbers: Object.assign(
    (sid: string) => ({ remove: () => removeMock(sid) }),
    {
      create: (...args: unknown[]) => createMock(...args),
      list: (...args: unknown[]) => findMock(...args),
    },
  ),
}
vi.mock('../twilio-client', () => ({
  callTwilio: (fn: (client: unknown) => unknown) => Promise.resolve().then(() => fn(fakeClient)),
}))

let appBaseUrl = 'https://app.example.com'
vi.mock('@/lib/config', () => ({
  requireSms: () => ({ accountSid: 'AC' + 'a'.repeat(32), authToken: 't', appBaseUrl }),
}))

import { findOwnedNumberSid, purchaseNumber, releaseNumber, searchAvailableNumbers } from '../numbers'

beforeEach(() => {
  vi.clearAllMocks()
  appBaseUrl = 'https://app.example.com'
})

describe('searchAvailableNumbers', () => {
  it('searches local SMS-capable numbers in the country, passing the area code as a number', async () => {
    listMock.mockResolvedValue([])

    await searchAvailableNumbers('CA', '416')

    expect(availableMock).toHaveBeenCalledWith('CA')
    expect(listMock).toHaveBeenCalledWith({ areaCode: 416, smsEnabled: true, limit: 20 })
  })

  it('maps results to the fields the dialog needs and nothing else', async () => {
    listMock.mockResolvedValue([
      {
        phoneNumber: '+14155550100',
        locality: 'San Francisco',
        region: 'CA',
        friendlyName: '(415) 555-0100',
        isoCountry: 'US',
        capabilities: { sms: true },
      },
      { phoneNumber: '+14155550101', locality: '', region: null },
    ])

    expect(await searchAvailableNumbers('US', '415')).toEqual([
      { phoneNumber: '+14155550100', locality: 'San Francisco', region: 'CA' },
      { phoneNumber: '+14155550101', locality: null, region: null },
    ])
  })
})

describe('purchaseNumber', () => {
  const PURCHASED = {
    sid: 'PN' + 'b'.repeat(32),
    phoneNumber: '+14155550100',
    capabilities: { sms: true, mms: false, voice: true },
  }

  it('buys the number with the webhook URL built from APP_BASE_URL and POST', async () => {
    createMock.mockResolvedValue(PURCHASED)

    const bought = await purchaseNumber('+14155550100')

    expect(createMock).toHaveBeenCalledWith({
      phoneNumber: '+14155550100',
      smsUrl: 'https://app.example.com/api/webhooks/sms',
      smsMethod: 'POST',
    })
    expect(bought).toEqual(PURCHASED)
  })

  it.each(['https://app.example.com/', 'https://app.example.com///'])(
    'does not double the slash when APP_BASE_URL is %s',
    async (base) => {
      appBaseUrl = base
      createMock.mockResolvedValue(PURCHASED)

      await purchaseNumber('+14155550100')

      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ smsUrl: 'https://app.example.com/api/webhooks/sms' }),
      )
    },
  )

  it('returns only sid, phoneNumber and the three capability flags', async () => {
    createMock.mockResolvedValue({ ...PURCHASED, accountSid: 'AC' + 'a'.repeat(32), uri: '/x' })

    expect(Object.keys(await purchaseNumber('+14155550100')).sort()).toEqual([
      'capabilities',
      'phoneNumber',
      'sid',
    ])
  })

  it('propagates an invalid-request failure so the caller can say the number is gone', async () => {
    createMock.mockRejectedValue(new SmsProviderError('taken', 'invalid-request', 400, 21422))

    await expect(purchaseNumber('+14155550100')).rejects.toMatchObject({ kind: 'invalid-request' })
  })
})

describe('releaseNumber', () => {
  it('removes the incoming number by sid', async () => {
    removeMock.mockResolvedValue(true)

    await releaseNumber('PN' + 'b'.repeat(32))

    expect(removeMock).toHaveBeenCalledWith('PN' + 'b'.repeat(32))
  })

  it('treats a number Twilio no longer has as already released', async () => {
    removeMock.mockRejectedValue(new SmsProviderError('gone', 'not-found', 404, 20404))

    await expect(releaseNumber('PN' + 'b'.repeat(32))).resolves.toBeUndefined()
  })

  it('rethrows every other failure, so the caller keeps the row', async () => {
    removeMock.mockRejectedValue(new SmsProviderError('down', 'unavailable', 503, null))

    await expect(releaseNumber('PN' + 'b'.repeat(32))).rejects.toMatchObject({ kind: 'unavailable' })
  })
})

describe('findOwnedNumberSid', () => {
  it('asks Twilio whether the account holds this exact number and returns its sid', async () => {
    findMock.mockResolvedValue([{ sid: 'PN' + 'c'.repeat(32), phoneNumber: '+14155550100' }])

    expect(await findOwnedNumberSid('+14155550100')).toBe('PN' + 'c'.repeat(32))
    expect(findMock).toHaveBeenCalledWith({ phoneNumber: '+14155550100', limit: 1 })
  })

  it('is null when the account does not hold it', async () => {
    findMock.mockResolvedValue([])

    expect(await findOwnedNumberSid('+14155550100')).toBeNull()
  })
})
