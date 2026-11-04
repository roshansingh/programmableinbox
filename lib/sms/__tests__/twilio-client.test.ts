import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const twilioCtor = vi.fn((..._args: unknown[]) => ({ marker: 'twilio-client' }))
vi.mock('twilio', () => ({ default: (...args: unknown[]) => twilioCtor(...args) }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }))

import { ConfigError, resetConfigCache } from '@/lib/config'
import { callTwilio, getTwilio, resetTwilioClientForTests } from '../twilio-client'
import { SmsProviderError } from '../errors'

const SID = 'AC' + 'a'.repeat(32)
const TOKEN = 't'.repeat(32)
const originalEnv = { ...process.env }

function enableSms() {
  process.env.SMS_ENABLED = 'true'
  process.env.TWILIO_ACCOUNT_SID = SID
  process.env.TWILIO_AUTH_TOKEN = TOKEN
  process.env.APP_BASE_URL = 'https://app.example.com'
}

beforeEach(() => {
  process.env = { ...originalEnv }
  delete process.env.SMS_ENABLED
  delete process.env.TWILIO_ACCOUNT_SID
  delete process.env.TWILIO_AUTH_TOKEN
  twilioCtor.mockClear()
  resetConfigCache()
  resetTwilioClientForTests()
})

afterEach(() => {
  process.env = { ...originalEnv }
  resetConfigCache()
  resetTwilioClientForTests()
})

describe('getTwilio', () => {
  it('can be imported with no SMS environment, and builds nothing until used', () => {
    // The import above already happened with SMS unset: `next build` evaluates
    // this module with no secrets, so construction must be deferred to first use.
    expect(twilioCtor).not.toHaveBeenCalled()
  })

  it('refuses to build a client while SMS_ENABLED is false, even with credentials set', () => {
    process.env.TWILIO_ACCOUNT_SID = SID
    process.env.TWILIO_AUTH_TOKEN = TOKEN
    process.env.APP_BASE_URL = 'https://app.example.com'

    try {
      getTwilio()
      throw new Error('expected getTwilio to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError)
      expect((error as ConfigError).variables).toContain('SMS_ENABLED')
    }
    expect(twilioCtor).not.toHaveBeenCalled()
  })

  it('builds one client from config and reuses it', () => {
    enableSms()

    const first = getTwilio()
    const second = getTwilio()

    expect(second).toBe(first)
    expect(twilioCtor).toHaveBeenCalledTimes(1)
    expect(twilioCtor).toHaveBeenCalledWith(
      SID,
      TOKEN,
      expect.objectContaining({ autoRetry: true, maxRetries: 3 }),
    )
  })
})

describe('callTwilio', () => {
  it('hands the client to the callback and returns its result', async () => {
    enableSms()
    const result = await callTwilio(async (client) => (client as unknown as { marker: string }).marker)
    expect(result).toBe('twilio-client')
  })

  it('maps a failure into an SmsProviderError', async () => {
    enableSms()
    const failure = Object.assign(new Error('Authenticate'), { status: 401, code: 20003 })

    const error = await callTwilio(async () => {
      throw failure
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(SmsProviderError)
    expect((error as SmsProviderError).kind).toBe('auth')
    expect((error as SmsProviderError).twilioCode).toBe(20003)
  })

  it('redacts the configured credentials from a mapped error', async () => {
    enableSms()

    const error = await callTwilio(async () => {
      throw Object.assign(new Error(`rejected ${SID} / ${TOKEN}`), { status: 401 })
    }).catch((e: unknown) => e)

    expect((error as SmsProviderError).message).not.toContain(SID)
    expect((error as SmsProviderError).message).not.toContain(TOKEN)
  })

  it('does not wrap a configuration error as a provider error', async () => {
    const error = await callTwilio(async () => 'unreachable').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ConfigError)
  })
})
