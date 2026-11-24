import { describe, expect, it, vi } from 'vitest'
import twilio from 'twilio'

const AUTH_TOKEN = 'a-test-auth-token-0123456789abcdef'
let appBaseUrl = 'https://app.example.com'

vi.mock('@/lib/config', () => ({
  requireSms: () => ({ accountSid: 'AC' + 'a'.repeat(32), authToken: AUTH_TOKEN, appBaseUrl }),
}))

import { MAX_BODY_LENGTH, parseInboundSms, smsWebhookUrl, verifyTwilioSignature } from '../webhook'

const params = {
  MessageSid: 'SM' + 'b'.repeat(32),
  From: '+14155550199',
  To: '+14155550100',
  Body: 'Your code is 123456',
  NumMedia: '0',
}

function signed(url: string, p: Record<string, string>, token = AUTH_TOKEN) {
  return twilio.getExpectedTwilioSignature(token, url, p)
}

describe('smsWebhookUrl', () => {
  it('appends the webhook path and trims trailing slashes from the base', () => {
    expect(smsWebhookUrl('https://x.test/')).toBe('https://x.test/api/webhooks/sms')
    expect(smsWebhookUrl('https://x.test///')).toBe('https://x.test/api/webhooks/sms')
  })
})

describe('verifyTwilioSignature', () => {
  const url = 'https://app.example.com/api/webhooks/sms'

  it('accepts a signature made over the configured URL with the auth token', () => {
    expect(verifyTwilioSignature(signed(url, params), params)).toBe(true)
  })

  it('rejects a missing header', () => {
    expect(verifyTwilioSignature(null, params)).toBe(false)
    expect(verifyTwilioSignature('', params)).toBe(false)
  })

  it('rejects a signature made with another token', () => {
    expect(verifyTwilioSignature(signed(url, params, 'some-other-token'), params)).toBe(false)
  })

  it('rejects a signature made over another URL, such as one built from an attacker-chosen Host', () => {
    const forged = signed('https://evil.example/api/webhooks/sms', params)

    expect(verifyTwilioSignature(forged, params)).toBe(false)
  })

  it('rejects a tampered parameter', () => {
    expect(verifyTwilioSignature(signed(url, params), { ...params, Body: 'Your code is 000000' })).toBe(false)
  })

  it('rejects an added parameter', () => {
    expect(verifyTwilioSignature(signed(url, params), { ...params, Extra: '1' })).toBe(false)
  })
})

describe('parseInboundSms', () => {
  it('normalizes a plain text message', () => {
    expect(parseInboundSms(params)).toEqual({
      externalId: params.MessageSid,
      from: '+14155550199',
      to: '+14155550100',
      body: 'Your code is 123456',
      mediaCount: 0,
    })
  })

  it('keeps a short-code or alphanumeric sender as presented', () => {
    expect(parseInboundSms({ ...params, From: '32665' })?.from).toBe('32665')
    expect(parseInboundSms({ ...params, From: 'AMAZON' })?.from).toBe('AMAZON')
  })

  it('accepts an empty body, as an MMS with media only has', () => {
    expect(parseInboundSms({ ...params, Body: '', NumMedia: '2' })).toMatchObject({ body: '', mediaCount: 2 })
  })

  it('treats a missing Body as empty', () => {
    const { Body: _omitted, ...rest } = params
    expect(parseInboundSms(rest)?.body).toBe('')
  })

  it('strips NUL bytes, which Postgres refuses in text', () => {
    expect(parseInboundSms({ ...params, Body: 'a\u0000b\u0000' })?.body).toBe('ab')
  })

  it('strips NUL bytes from the identifying fields too, so none can make the insert throw', () => {
    expect(
      parseInboundSms({ ...params, MessageSid: 'SM\u0000x', From: '3\u00002665', To: '+1415\u00005550100' }),
    ).toMatchObject({ externalId: 'SMx', from: '32665', to: '+14155550100' })
  })

  it('caps an oversized body rather than rejecting it', () => {
    const parsed = parseInboundSms({ ...params, Body: 'x'.repeat(MAX_BODY_LENGTH + 500) })

    expect(parsed?.body).toHaveLength(MAX_BODY_LENGTH)
  })

  it('does not split an emoji when capping', () => {
    const parsed = parseInboundSms({ ...params, Body: '😀'.repeat(MAX_BODY_LENGTH) })

    expect(parsed?.body.endsWith('😀')).toBe(true)
    expect(parsed?.body).not.toMatch(/[\uD800-\uDBFF]$/)
  })

  it('reads NumMedia as a non-negative integer, defaulting to 0', () => {
    expect(parseInboundSms({ ...params, NumMedia: 'abc' })?.mediaCount).toBe(0)
    expect(parseInboundSms({ ...params, NumMedia: '-3' })?.mediaCount).toBe(0)
    expect(parseInboundSms({ ...params, NumMedia: '1.5' })?.mediaCount).toBe(0)
    const { NumMedia: _omitted, ...rest } = params
    expect(parseInboundSms(rest)?.mediaCount).toBe(0)
  })

  it.each(['MessageSid', 'From', 'To'])('returns null when %s is missing or blank', (key) => {
    expect(parseInboundSms({ ...params, [key]: '' })).toBeNull()
    const { [key]: _omitted, ...rest } = params as Record<string, string>
    expect(parseInboundSms(rest)).toBeNull()
  })
})
