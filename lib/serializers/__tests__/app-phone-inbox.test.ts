import { describe, expect, it } from 'vitest'
import { serializeAppPhoneInbox } from '../app/phone-inbox'

const ROW = {
  id: 'phone_1',
  organizationId: 'org_1',
  userId: 'user_1',
  phoneNumber: '+14155550100',
  countryCode: 'US',
  twilioSid: 'PN' + 'a'.repeat(32),
  status: 'active' as const,
  capabilities: { sms: true, mms: false, voice: false },
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
}

describe('serializeAppPhoneInbox', () => {
  it('publishes exactly this key set', () => {
    expect(Object.keys(serializeAppPhoneInbox(ROW, 'user_1')).sort()).toEqual([
      'capabilities',
      'countryCode',
      'createdAt',
      'id',
      'isOwner',
      'organizationId',
      'phoneNumber',
      'status',
      'updatedAt',
    ])
  })

  it('marks the creating user as owner and a teammate as not', () => {
    expect(serializeAppPhoneInbox(ROW, 'user_1').isOwner).toBe(true)
    expect(serializeAppPhoneInbox(ROW, 'user_2').isOwner).toBe(false)
  })

  it('does not expose the Twilio sid or the raw creator id', () => {
    const out = serializeAppPhoneInbox(ROW, 'user_2')
    expect(out).not.toHaveProperty('twilioSid')
    expect(out).not.toHaveProperty('userId')
  })

  it('serializes dates as ISO strings and a missing capabilities object as null', () => {
    const out = serializeAppPhoneInbox({ ...ROW, capabilities: null }, 'user_1')
    expect(out.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(out.capabilities).toBeNull()
  })
})
