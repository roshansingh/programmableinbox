import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const searchMock = vi.fn()
const purchaseMock = vi.fn()
const releaseMock = vi.fn()
const availableMock = vi.fn()
vi.mock('@/lib/sms/numbers', () => ({
  searchAvailableNumbers: (...args: unknown[]) => searchMock(...args),
  purchaseNumber: (...args: unknown[]) => purchaseMock(...args),
  releaseNumber: (...args: unknown[]) => releaseMock(...args),
  isNumberAvailable: (...args: unknown[]) => availableMock(...args),
  findOwnedNumberSid: async () => null,
}))

import { GET, POST } from '@/app/api/app/phoneInbox/route'
import * as idRoute from '@/app/api/app/phoneInbox/[id]/route'
import { GET as available } from '@/app/api/app/phoneInbox/available/route'
import { ConfigError } from '@/lib/config'
import { CommercialProvider } from '@/lib/commercial/provider'
import { UNLIMITED, type PlanLimits } from '@/lib/commercial/plan-limits'
import { prisma } from '@/lib/db'
import { SmsProviderError } from '@/lib/sms/errors'
import { withConfigEnv, setConfigEnv } from '@/test/config'
import { createOrgWithUser, createSecondOrg } from './helpers/auth'
import { jsonRequest, params } from './helpers/request'

const { GET: getById, DELETE: deleteById } = idRoute

withConfigEnv({
  SMS_ENABLED: 'true',
  TWILIO_ACCOUNT_SID: 'AC' + 'a'.repeat(32),
  TWILIO_AUTH_TOKEN: 't'.repeat(32),
  APP_BASE_URL: 'https://app.example.com',
})

// A live number is unique across all organizations, so every seed needs its own.
let seeded = 0
function nextNumber() {
  seeded += 1
  return `+1415557${String(seeded).padStart(4, '0')}`
}

function seedPhoneInbox(
  orgId: string,
  userId: string,
  over: { phoneNumber?: string; status?: 'pending' | 'active' | 'released' | 'failed' } = {},
) {
  const phoneNumber = over.phoneNumber ?? nextNumber()
  const status = over.status ?? 'active'
  return prisma.phoneInbox.create({
    data: {
      organizationId: orgId,
      userId,
      phoneNumber,
      countryCode: 'US',
      status,
      providerId: status === 'active' ? 'PN' + phoneNumber.replace(/\D/g, '').padEnd(32, '0') : null,
    },
  })
}

async function addTeammate(orgId: string) {
  const mate = await createOrgWithUser()
  await prisma.membership.create({
    data: { userId: mate.user.id, organizationId: orgId, role: 'member' as never },
  })
  return mate
}

function planWith(overrides: Partial<PlanLimits>) {
  CommercialProvider.configure(
    {
      resolve: async () => ({
        planCode: 'test',
        planName: 'Test',
        limits: { ...UNLIMITED, ...overrides },
        periodStart: null,
        periodEnd: null,
      }),
    },
    CommercialProvider.quota,
    CommercialProvider.metering,
  )
}

function post(token: string, body: unknown) {
  return POST(
    jsonRequest('http://localhost/api/app/phoneInbox', { method: 'POST', credential: token, body }),
  )
}

beforeEach(() => {
  searchMock.mockReset()
  purchaseMock.mockReset()
  releaseMock.mockReset()
  releaseMock.mockResolvedValue(undefined)
  availableMock.mockReset()
  availableMock.mockResolvedValue(true)
})

afterEach(() => CommercialProvider.reset())

function purchasedFor(phoneNumber: string) {
  return {
    sid: 'PN' + phoneNumber.replace(/\D/g, '').padEnd(32, '1'),
    phoneNumber,
    capabilities: { sms: true, mms: false, voice: true },
  }
}

describe('POST /api/app/phoneInbox', () => {
  it('401 without a token', async () => {
    const res = await POST(jsonRequest('http://localhost/api/app/phoneInbox', { method: 'POST', body: {} }))
    expect(res.status).toBe(401)
  })

  it('buys the number and returns the serialized, active inbox', async () => {
    const { org, user, token } = await createOrgWithUser()
    const number = nextNumber()
    purchaseMock.mockResolvedValue(purchasedFor(number))

    const res = await post(token, { organizationId: org.id, phoneNumber: number, countryCode: 'US' })

    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data).toMatchObject({
      organizationId: org.id,
      phoneNumber: number,
      countryCode: 'US',
      status: 'active',
      isOwner: true,
      capabilities: { sms: true, mms: false, voice: true },
    })
    expect(data).not.toHaveProperty('providerId')
    expect(purchaseMock).toHaveBeenCalledWith(number)

    const row = await prisma.phoneInbox.findUniqueOrThrow({ where: { id: data.id } })
    expect(row.userId).toBe(user.id)
    expect(row.providerId).not.toBeNull()
  })

  it('403 in an org you do not belong to, and buys nothing', async () => {
    const { token } = await createOrgWithUser()
    const other = await createSecondOrg()

    const res = await post(token, {
      organizationId: other.org.id,
      phoneNumber: nextNumber(),
      countryCode: 'US',
    })

    expect(res.status).toBe(403)
    expect(purchaseMock).not.toHaveBeenCalled()
  })

  it.each([
    ['no fields', {}],
    ['a digits-only number', { phoneNumber: '4155550100', countryCode: 'US' }],
    ['a number with formatting', { phoneNumber: '+1 (415) 555-0100', countryCode: 'US' }],
    ['an unsupported country', { phoneNumber: '+447700900123', countryCode: 'GB' }],
    // The bypass: a valid country label wrapped around a number from elsewhere.
    ['a non-North-American number labelled US', { phoneNumber: '+447700900123', countryCode: 'US' }],
  ])('400 for %s', async (_label, fields) => {
    const { org, token } = await createOrgWithUser()

    const res = await post(token, { organizationId: org.id, ...fields })

    expect(res.status).toBe(400)
    expect(purchaseMock).not.toHaveBeenCalled()
  })

  it('402 when the plan does not include phone inboxes, and buys nothing', async () => {
    const { org, token } = await createOrgWithUser()
    planWith({ phoneInboxesEnabled: false })

    const res = await post(token, { organizationId: org.id, phoneNumber: nextNumber(), countryCode: 'US' })

    expect(res.status).toBe(402)
    expect(purchaseMock).not.toHaveBeenCalled()
  })

  it('402 at the plan limit, counting live numbers but not released or failed ones', async () => {
    const { org, user, token } = await createOrgWithUser()
    planWith({ phoneInboxes: 1 })
    await seedPhoneInbox(org.id, user.id, { status: 'released' })
    await seedPhoneInbox(org.id, user.id, { status: 'failed' })
    const number = nextNumber()
    purchaseMock.mockResolvedValue(purchasedFor(number))

    const first = await post(token, { organizationId: org.id, phoneNumber: number, countryCode: 'US' })
    expect(first.status).toBe(201)

    const second = await post(token, { organizationId: org.id, phoneNumber: nextNumber(), countryCode: 'US' })
    expect(second.status).toBe(402)
  })

  it('503 naming the problem when SMS is not enabled, and buys nothing', async () => {
    const { org, token } = await createOrgWithUser()
    setConfigEnv({ SMS_ENABLED: 'false' })

    const res = await post(token, { organizationId: org.id, phoneNumber: nextNumber(), countryCode: 'US' })

    expect(res.status).toBe(503)
    expect((await res.json()).message).toMatch(/SMS is not enabled/i)
    expect(purchaseMock).not.toHaveBeenCalled()
  })

  it('409 when Twilio no longer sells the number', async () => {
    const { org, token } = await createOrgWithUser()
    purchaseMock.mockRejectedValue(new SmsProviderError('taken', 'invalid-request', 400, 21422))

    const res = await post(token, { organizationId: org.id, phoneNumber: nextNumber(), countryCode: 'US' })

    expect(res.status).toBe(409)
    expect((await res.json()).message).toBe('That number is no longer available')
  })

  it('409, and buys nothing, for a well-formed number the local inventory does not offer', async () => {
    const { org, token } = await createOrgWithUser()
    availableMock.mockResolvedValue(false)

    // A crafted request: +1 shaped, labelled US, but toll-free.
    const res = await post(token, { organizationId: org.id, phoneNumber: '+18005550100', countryCode: 'US' })

    expect(res.status).toBe(409)
    expect(purchaseMock).not.toHaveBeenCalled()
  })

  it('409 when another organization already holds the number, without calling Twilio', async () => {
    const { org, token } = await createOrgWithUser()
    const other = await createSecondOrg()
    const number = nextNumber()
    await seedPhoneInbox(other.org.id, other.user.id, { phoneNumber: number })

    const res = await post(token, { organizationId: org.id, phoneNumber: number, countryCode: 'US' })

    expect(res.status).toBe(409)
    expect(purchaseMock).not.toHaveBeenCalled()
  })

  it('503 when the provider is down, and 502 for any other provider failure, never echoing details', async () => {
    const { org, token } = await createOrgWithUser()

    purchaseMock.mockRejectedValueOnce(new SmsProviderError('down', 'unavailable', 503, null))
    const down = await post(token, { organizationId: org.id, phoneNumber: nextNumber(), countryCode: 'US' })
    expect(down.status).toBe(503)

    purchaseMock.mockRejectedValueOnce(new SmsProviderError('bad creds sk-secret-detail', 'auth', 401, 20003))
    const auth = await post(token, { organizationId: org.id, phoneNumber: nextNumber(), countryCode: 'US' })
    expect(auth.status).toBe(502)
    expect(JSON.stringify(await auth.json())).not.toContain('sk-secret-detail')
  })
})

describe('GET /api/app/phoneInbox/available', () => {
  function search(token: string, query: string) {
    return available(jsonRequest(`http://localhost/api/app/phoneInbox/available?${query}`, { credential: token }))
  }

  it('401 without a token', async () => {
    const res = await available(jsonRequest('http://localhost/api/app/phoneInbox/available'))
    expect(res.status).toBe(401)
  })

  it('returns the numbers Twilio offers for the country and area code', async () => {
    const { org, token } = await createOrgWithUser()
    const offered = [{ phoneNumber: '+14155550100', locality: 'San Francisco', region: 'CA' }]
    searchMock.mockResolvedValue(offered)

    const res = await search(token, `organizationId=${org.id}&country=US&areaCode=415`)

    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual(offered)
    expect(searchMock).toHaveBeenCalledWith('US', '415')
  })

  it.each([
    ['an unsupported country', 'country=GB&areaCode=415'],
    ['a missing country', 'areaCode=415'],
    ['a two-digit area code', 'country=US&areaCode=41'],
    ['a four-digit area code', 'country=US&areaCode=4155'],
    ['a non-numeric area code', 'country=US&areaCode=abc'],
  ])('400 for %s', async (_label, query) => {
    const { org, token } = await createOrgWithUser()

    const res = await search(token, `organizationId=${org.id}&${query}`)

    expect(res.status).toBe(400)
    expect(searchMock).not.toHaveBeenCalled()
  })

  it('403 for an organization you do not belong to', async () => {
    const { token } = await createOrgWithUser()
    const other = await createSecondOrg()

    const res = await search(token, `organizationId=${other.org.id}&country=US&areaCode=415`)

    expect(res.status).toBe(403)
    expect(searchMock).not.toHaveBeenCalled()
  })

  it('402 when the plan does not include phone inboxes', async () => {
    const { org, token } = await createOrgWithUser()
    planWith({ phoneInboxesEnabled: false })

    const res = await search(token, `organizationId=${org.id}&country=US&areaCode=415`)

    expect(res.status).toBe(402)
    expect(searchMock).not.toHaveBeenCalled()
  })

  it('503 when SMS is not enabled', async () => {
    const { org, token } = await createOrgWithUser()
    setConfigEnv({ SMS_ENABLED: 'false' })

    const res = await search(token, `organizationId=${org.id}&country=US&areaCode=415`)

    expect(res.status).toBe(503)
    expect(searchMock).not.toHaveBeenCalled()
  })

  it('503 when Twilio is unavailable', async () => {
    const { org, token } = await createOrgWithUser()
    searchMock.mockRejectedValue(new SmsProviderError('down', 'unavailable', 503, null))

    const res = await search(token, `organizationId=${org.id}&country=US&areaCode=415`)

    expect(res.status).toBe(503)
  })
})

describe('GET /api/app/phoneInbox', () => {
  it('401 without a token', async () => {
    const res = await GET(jsonRequest('http://localhost/api/app/phoneInbox'))
    expect(res.status).toBe(401)
  })

  it("lists the organization's live numbers, flags a teammate's as not yours, and hides other orgs", async () => {
    const { org, user, token } = await createOrgWithUser()
    const mine = await seedPhoneInbox(org.id, user.id)
    const mate = await addTeammate(org.id)
    const theirs = await seedPhoneInbox(org.id, mate.user.id)
    const other = await createSecondOrg()
    await seedPhoneInbox(other.org.id, other.user.id)

    const res = await GET(jsonRequest('http://localhost/api/app/phoneInbox', { credential: token }))

    expect(res.status).toBe(200)
    const { data } = await res.json()
    const byId = Object.fromEntries(data.map((i: { id: string; isOwner: boolean }) => [i.id, i.isOwner]))
    expect(byId).toEqual({ [mine.id]: true, [theirs.id]: false })
  })

  it('omits released and failed numbers, including rows that predate real provisioning', async () => {
    const { org, user, token } = await createOrgWithUser()
    const live = await seedPhoneInbox(org.id, user.id)
    await seedPhoneInbox(org.id, user.id, { status: 'released' })
    await seedPhoneInbox(org.id, user.id, { status: 'failed' })

    const res = await GET(jsonRequest('http://localhost/api/app/phoneInbox', { credential: token }))

    const { data } = await res.json()
    expect(data.map((i: { id: string }) => i.id)).toEqual([live.id])
  })

  it('403 when narrowing to an organization you do not belong to', async () => {
    const { token } = await createOrgWithUser()
    const other = await createSecondOrg()

    const res = await GET(
      jsonRequest(`http://localhost/api/app/phoneInbox?organizationId=${other.org.id}`, { credential: token }),
    )

    expect(res.status).toBe(403)
  })
})

describe('GET /api/app/phoneInbox/[id]', () => {
  it('401 without a token', async () => {
    const res = await getById(
      jsonRequest('http://localhost/api/app/phoneInbox/some-id'),
      params({ id: 'some-id' }),
    )
    expect(res.status).toBe(401)
  })

  it('gets an inbox, including one a teammate created', async () => {
    const { org, token } = await createOrgWithUser()
    const mate = await addTeammate(org.id)
    const inbox = await seedPhoneInbox(org.id, mate.user.id)

    const res = await getById(
      jsonRequest(`http://localhost/api/app/phoneInbox/${inbox.id}`, { credential: token }),
      params({ id: inbox.id }),
    )

    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data).toMatchObject({ id: inbox.id, phoneNumber: inbox.phoneNumber, isOwner: false })
  })

  it("404 for another org's inbox, never 403", async () => {
    const { token } = await createOrgWithUser()
    const other = await createSecondOrg()
    const otherInbox = await seedPhoneInbox(other.org.id, other.user.id)

    const res = await getById(
      jsonRequest(`http://localhost/api/app/phoneInbox/${otherInbox.id}`, { credential: token }),
      params({ id: otherInbox.id }),
    )

    expect(res.status).toBe(404)
  })

  it('404 for a released number', async () => {
    const { org, user, token } = await createOrgWithUser()
    const gone = await seedPhoneInbox(org.id, user.id, { status: 'released' })

    const res = await getById(
      jsonRequest(`http://localhost/api/app/phoneInbox/${gone.id}`, { credential: token }),
      params({ id: gone.id }),
    )

    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/app/phoneInbox/[id]', () => {
  it('no longer exists: a purchased number is immutable', () => {
    expect((idRoute as Record<string, unknown>).PATCH).toBeUndefined()
  })
})

describe('DELETE /api/app/phoneInbox/[id]', () => {
  function del(token: string, id: string) {
    return deleteById(
      jsonRequest(`http://localhost/api/app/phoneInbox/${id}`, { method: 'DELETE', credential: token }),
      params({ id }),
    )
  }

  it('401 without a token', async () => {
    const res = await deleteById(
      jsonRequest('http://localhost/api/app/phoneInbox/some-id', { method: 'DELETE' }),
      params({ id: 'some-id' }),
    )
    expect(res.status).toBe(401)
  })

  it('releases the number at Twilio, retires the row, and hides it everywhere', async () => {
    const { org, user, token } = await createOrgWithUser()
    const inbox = await seedPhoneInbox(org.id, user.id)

    const res = await del(token, inbox.id)

    expect(res.status).toBe(204)
    expect(releaseMock).toHaveBeenCalledWith(inbox.providerId)
    const row = await prisma.phoneInbox.findFirstOrThrow({ where: { id: inbox.id, deletedAt: { not: null } } })
    expect(row.status).toBe('released')
    expect(row.phoneNumber).toBe(inbox.phoneNumber)

    const getRes = await getById(
      jsonRequest(`http://localhost/api/app/phoneInbox/${inbox.id}`, { credential: token }),
      params({ id: inbox.id }),
    )
    expect(getRes.status).toBe(404)
    const list = await (await GET(jsonRequest('http://localhost/api/app/phoneInbox', { credential: token }))).json()
    expect(list.data.find((i: { id: string }) => i.id === inbox.id)).toBeUndefined()
  })

  it('404 for a teammate who did not create it, and releases nothing', async () => {
    const { org, user } = await createOrgWithUser()
    const mate = await addTeammate(org.id)
    const inbox = await seedPhoneInbox(org.id, user.id)

    const res = await del(mate.token, inbox.id)

    expect(res.status).toBe(404)
    expect(releaseMock).not.toHaveBeenCalled()
    expect((await prisma.phoneInbox.findUniqueOrThrow({ where: { id: inbox.id } })).status).toBe('active')
  })

  it("404 for another org's inbox, and releases nothing", async () => {
    const { token } = await createOrgWithUser()
    const other = await createSecondOrg()
    const otherInbox = await seedPhoneInbox(other.org.id, other.user.id)

    const res = await del(token, otherInbox.id)

    expect(res.status).toBe(404)
    expect(releaseMock).not.toHaveBeenCalled()
  })

  it('503 and an untouched, retryable row when Twilio is down', async () => {
    const { org, user, token } = await createOrgWithUser()
    const inbox = await seedPhoneInbox(org.id, user.id)
    releaseMock.mockRejectedValueOnce(new SmsProviderError('down', 'unavailable', 503, null))

    const res = await del(token, inbox.id)

    expect(res.status).toBe(503)
    const row = await prisma.phoneInbox.findUniqueOrThrow({ where: { id: inbox.id } })
    expect(row.status).toBe('active')
    expect(row.deletedAt).toBeNull()

    expect((await del(token, inbox.id)).status).toBe(204)
  })

  it('503 naming the problem when SMS has been switched off since the number was bought', async () => {
    const { org, user, token } = await createOrgWithUser()
    const inbox = await seedPhoneInbox(org.id, user.id)
    releaseMock.mockRejectedValueOnce(new ConfigError('SMS_ENABLED is false', ['SMS_ENABLED']))

    const res = await del(token, inbox.id)

    expect(res.status).toBe(503)
    expect((await res.json()).message).toMatch(/SMS is not enabled/i)
    expect((await prisma.phoneInbox.findUniqueOrThrow({ where: { id: inbox.id } })).status).toBe('active')
  })
})
