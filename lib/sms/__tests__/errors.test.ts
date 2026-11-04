import { describe, it, expect } from 'vitest'
import { mapTwilioError, SmsProviderError } from '../errors'

/** Shaped like twilio's `RestException`: an Error with `status` and `code`. */
function restException(status: number, message: string, code?: number): Error {
  return Object.assign(new Error(message), { status, code })
}

describe('mapTwilioError', () => {
  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [400, 'invalid-request'],
    [404, 'not-found'],
    [429, 'rate-limited'],
    [500, 'unavailable'],
    [503, 'unavailable'],
    [418, 'unknown'],
  ] as const)('maps HTTP %i to %s', (status, kind) => {
    const mapped = mapTwilioError(restException(status, 'boom'))
    expect(mapped).toBeInstanceOf(SmsProviderError)
    expect(mapped.kind).toBe(kind)
    expect(mapped.status).toBe(status)
  })

  it('copies a numeric Twilio error code', () => {
    expect(mapTwilioError(restException(400, 'bad number', 21211)).twilioCode).toBe(21211)
  })

  it('leaves twilioCode null when the code is not a number', () => {
    const err = Object.assign(new Error('x'), { status: 400, code: 'ECONNRESET' })
    expect(mapTwilioError(err).twilioCode).toBeNull()
  })

  it('maps a network error with no HTTP status to unavailable', () => {
    const err = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
    const mapped = mapTwilioError(err)
    expect(mapped.kind).toBe('unavailable')
    expect(mapped.status).toBeNull()
  })

  it.each([['a thrown string', 'oops'], ['undefined', undefined], ['null', null]])(
    'maps %s to unknown without crashing',
    (_label, thrown) => {
      expect(mapTwilioError(thrown).kind).toBe('unknown')
    },
  )

  it('passes an already-mapped error through unchanged', () => {
    const mapped = mapTwilioError(restException(404, 'gone'))
    expect(mapTwilioError(mapped)).toBe(mapped)
  })

  describe('redaction', () => {
    const SID = 'AC' + 'a'.repeat(32)
    const TOKEN = 'secret-token-value'

    it('never includes the account SID or auth token in the message', () => {
      const mapped = mapTwilioError(
        restException(401, `Authenticate failed for ${SID} using ${TOKEN}`),
        [SID, TOKEN],
      )
      expect(mapped.message).not.toContain(SID)
      expect(mapped.message).not.toContain(TOKEN)
      expect(mapped.message).toContain('[redacted]')
    })

    it('redacts anything shaped like an account SID even when it was not passed in', () => {
      const other = 'AC' + 'b'.repeat(32)
      const mapped = mapTwilioError(restException(404, `No such account ${other}`))
      expect(mapped.message).not.toContain(other)
    })

    it('redacts newly supplied secrets when remapping an already-mapped error', () => {
      const first = mapTwilioError(restException(401, `bad ${TOKEN}`))
      expect(first.message).toContain(TOKEN)

      const second = mapTwilioError(first, [TOKEN])

      expect(second.message).not.toContain(TOKEN)
      expect(second.stack).not.toContain(TOKEN)
      expect(second).toBeInstanceOf(SmsProviderError)
      expect(second.kind).toBe(first.kind)
      expect(second.status).toBe(first.status)
      expect(second.twilioCode).toBe(first.twilioCode)
    })

    it('returns an already-clean mapped error unchanged', () => {
      const first = mapTwilioError(restException(401, 'bad credentials'), [TOKEN])
      expect(mapTwilioError(first, [TOKEN])).toBe(first)
    })

    it('does not keep the original error as a cause', () => {
      const mapped = mapTwilioError(restException(401, `bad ${TOKEN}`), [TOKEN])
      expect(mapped.cause).toBeUndefined()
    })
  })
})
