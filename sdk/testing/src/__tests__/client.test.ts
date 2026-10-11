import { afterEach, describe, expect, it } from 'vitest'
import { startStub } from '../../test-support/stub-server.mjs'
import { createPibxClient } from '../client.js'
import { PibxAuthError, PibxHttpError, PibxTimeoutError } from '../errors.js'
import type { Clock } from '../poll.js'

type Stub = Awaited<ReturnType<typeof startStub>>
let stub: Stub | undefined
afterEach(async () => {
  await stub?.close()
  stub = undefined
})

const KEY = 'sk_live_supersecretkey'
const otpBody = (otp: string, createdAt: string) => ({
  data: { otp, message: { id: 'm1', subject: 'Your code', from: 'noreply@openai.com', extractedOtp: otp, createdAt } },
})
const fast = { pollIntervalMs: 5, timeoutMs: 400 }

function fakeClock(): Clock & { slept: number[] } {
  let t = 0
  const slept: number[] = []
  return { slept, now: () => t, sleep: async (ms) => { slept.push(ms); t += ms } }
}

async function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  const prev: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    await fn()
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

describe('createPibxClient', () => {
  it('throws at construction when no key is available, naming the variable', async () => {
    await withEnv({ PIBX_API_KEY: undefined }, () => {
      expect(() => createPibxClient()).toThrow(/PIBX_API_KEY/)
    })
  })
})

describe('createInbox', () => {
  it('POSTs the address and returns the inbox', async () => {
    stub = await startStub({
      'POST /api/v1/emailInbox': () => ({
        status: 201,
        body: { data: { id: 'inbx_1', email: 'qa@x.dev', name: 'QA', createdAt: '2026-10-11T00:00:00Z' } },
      }),
    })
    const client = createPibxClient({ apiKey: KEY, baseUrl: stub.url })
    const inbox = await client.createInbox({ email: 'qa@x.dev', name: 'QA' })
    expect(inbox.id).toBe('inbx_1')
    expect(stub.requests[0].body).toEqual({ email: 'qa@x.dev', name: 'QA' })
    expect(stub.requests[0].headers.authorization).toBe(`Bearer ${KEY}`)
  })
})

describe('waitForOtp', () => {
  it('polls through 404s and returns the code with its message', async () => {
    let n = 0
    stub = await startStub({
      'GET /api/v1/emailInbox/inbx_1/otp': () =>
        ++n < 3
          ? { status: 404, body: { message: 'No OTP' } }
          : { status: 200, body: otpBody('424242', '2026-10-11T10:00:05Z') },
    })
    const client = createPibxClient({ apiKey: KEY, baseUrl: stub.url })
    const res = await client.waitForOtp({
      inboxId: 'inbx_1',
      since: '2026-10-11T10:00:00Z',
      from: 'openai.com',
      ...fast,
    })
    expect(res.otp).toBe('424242')
    expect(res.message.id).toBe('m1')
    expect(n).toBe(3)
    expect(stub.requests[0].query).toMatchObject({ from: 'openai.com', withinMinutes: '15' })
  })

  it('skips a stale code older than `since` and keeps waiting for a fresh one', async () => {
    let n = 0
    stub = await startStub({
      'GET /api/v1/emailInbox/inbx_1/otp': () =>
        ++n < 3
          ? { status: 200, body: otpBody('111111', '2026-10-11T09:00:00Z') }
          : { status: 200, body: otpBody('222222', '2026-10-11T10:00:09Z') },
    })
    const client = createPibxClient({ apiKey: KEY, baseUrl: stub.url })
    const res = await client.waitForOtp({ inboxId: 'inbx_1', since: new Date('2026-10-11T10:00:00Z'), ...fast })
    expect(res.otp).toBe('222222')
  })

  it('rejects an unparseable since immediately, without a request', async () => {
    stub = await startStub({})
    const client = createPibxClient({ apiKey: KEY, baseUrl: stub.url })
    await expect(client.waitForOtp({ inboxId: 'inbx_1', since: 'yesterday', ...fast })).rejects.toThrow(TypeError)
    await expect(client.waitForOtp({ inboxId: 'inbx_1', since: '', ...fast })).rejects.toThrow(TypeError)
    expect(stub.requests).toHaveLength(0)
  })

  it('does not retry on 401/403', async () => {
    stub = await startStub({ 'GET /api/v1/emailInbox/inbx_1/otp': () => ({ status: 403, body: { message: 'nope' } }) })
    const client = createPibxClient({ apiKey: KEY, baseUrl: stub.url })
    await expect(client.waitForOtp({ inboxId: 'inbx_1', since: new Date(0), ...fast })).rejects.toBeInstanceOf(
      PibxAuthError,
    )
    expect(stub.requests).toHaveLength(1)
  })

  it('times out with PibxTimeoutError carrying the last status', async () => {
    stub = await startStub({ 'GET /api/v1/emailInbox/inbx_1/otp': () => ({ status: 404, body: {} }) })
    const client = createPibxClient({ apiKey: KEY, baseUrl: stub.url })
    const err = await client
      .waitForOtp({ inboxId: 'inbx_1', since: new Date(0), pollIntervalMs: 5, timeoutMs: 40 })
      .catch((e) => e)
    expect(err).toBeInstanceOf(PibxTimeoutError)
    expect(err.lastStatus).toBe(404)
  })

  it('keeps a path prefix and ignores a trailing slash on baseUrl', async () => {
    stub = await startStub({
      'GET /pibx/api/v1/emailInbox/inbx_1/otp': () => ({ status: 200, body: otpBody('1', '2026-10-11T10:00:01Z') }),
    })
    const client = createPibxClient({ apiKey: KEY, baseUrl: `${stub.url}/pibx/` })
    await client.waitForOtp({ inboxId: 'inbx_1', since: '2026-10-11T10:00:00Z', ...fast })
    expect(stub.requests[0].path).toBe('/pibx/api/v1/emailInbox/inbx_1/otp')
  })

  it('percent-encodes the inbox id into the path', async () => {
    stub = await startStub({
      'GET /api/v1/emailInbox/a%2Fb%3Fc/otp': () => ({ status: 200, body: otpBody('1', '2026-10-11T10:00:01Z') }),
    })
    const client = createPibxClient({ apiKey: KEY, baseUrl: stub.url })
    await client.waitForOtp({ inboxId: 'a/b?c', since: '2026-10-11T10:00:00Z', ...fast })
    expect(stub.requests[0].path).toBe('/api/v1/emailInbox/a%2Fb%3Fc/otp')
  })

  it('turns a 200 with a non-contract body into PibxHttpError', async () => {
    stub = await startStub({
      'GET /api/v1/emailInbox/inbx_1/otp': () => ({ status: 200, body: '<html>Bad gateway</html>' }),
    })
    const client = createPibxClient({ apiKey: KEY, baseUrl: stub.url })
    await expect(client.waitForOtp({ inboxId: 'inbx_1', since: new Date(0), ...fast })).rejects.toBeInstanceOf(
      PibxHttpError,
    )
  })

  it('never puts the API key in an error', async () => {
    stub = await startStub({ 'GET /api/v1/emailInbox/inbx_1/otp': () => ({ status: 401, body: { message: 'bad' } }) })
    const client = createPibxClient({ apiKey: KEY, baseUrl: stub.url })
    const err = await client.waitForOtp({ inboxId: 'inbx_1', since: new Date(0), ...fast }).catch((e) => e)
    expect(String(err.message)).not.toContain(KEY)
    expect(String(err.stack)).not.toContain(KEY)
  })

  it('retries a 429 and honours Retry-After seconds', async () => {
    let n = 0
    stub = await startStub({
      'GET /api/v1/emailInbox/inbx_1/otp': () =>
        ++n < 2
          ? { status: 429, headers: { 'retry-after': '0' }, body: { message: 'slow down' } }
          : { status: 200, body: otpBody('9', '2026-10-11T10:00:09Z') },
    })
    const client = createPibxClient({ apiKey: KEY, baseUrl: stub.url })
    const res = await client.waitForOtp({ inboxId: 'inbx_1', since: '2026-10-11T10:00:00Z', ...fast })
    expect(res.otp).toBe('9')
  })

  it('gives up on a request that never answers instead of hanging past the deadline', async () => {
    stub = await startStub({ 'GET /api/v1/emailInbox/inbx_1/otp': () => new Promise(() => {}) })
    const client = createPibxClient({ apiKey: KEY, baseUrl: stub.url, requestTimeoutMs: 50 })
    const started = Date.now()
    const err = await client
      .waitForOtp({ inboxId: 'inbx_1', since: new Date(0), pollIntervalMs: 10, timeoutMs: 300 })
      .catch((e) => e)
    expect(err).toBeInstanceOf(PibxTimeoutError)
    expect(err.lastStatus).toBeUndefined()
    expect(err.message).toContain('last error')
    expect(stub.requests.length).toBeGreaterThan(1)
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it('surfaces a refused connection as lastError rather than a bare timeout', async () => {
    const client = createPibxClient({ apiKey: KEY, baseUrl: 'http://127.0.0.1:1' })
    const err = await client
      .waitForOtp({ inboxId: 'inbx_1', since: new Date(0), pollIntervalMs: 10, timeoutMs: 150 })
      .catch((e) => e)
    expect(err).toBeInstanceOf(PibxTimeoutError)
    expect(err.message).toContain('last error')
  })
})

describe('waitForMessage', () => {
  const msg = (id: string, subject: string, createdAt: string) => ({
    id, subject, from: 'a@b.c', extractedOtp: null, createdAt,
  })

  it('returns the newest message at or after since matching the subject', async () => {
    stub = await startStub({
      'GET /api/v1/emailInbox/inbx_1/messages': () => ({
        status: 200,
        body: {
          data: {
            messages: [
              msg('new-other', 'Welcome', '2026-10-11T10:00:09Z'),
              msg('new-match', 'Reset your password', '2026-10-11T10:00:08Z'),
              msg('old-match', 'Reset your password', '2026-10-11T08:00:00Z'),
            ],
            nextCursor: null,
            hasMore: false,
          },
        },
      }),
    })
    const client = createPibxClient({ apiKey: KEY, baseUrl: stub.url })
    const m = await client.waitForMessage({
      inboxId: 'inbx_1',
      since: '2026-10-11T10:00:00Z',
      subject: 'RESET',
      from: 'openai.com',
      ...fast,
    })
    expect(m.id).toBe('new-match')
    expect(stub.requests[0].query).toMatchObject({ from: 'openai.com', limit: '50', grouped: 'false' })
  })

  it('keeps polling while nothing qualifies, then times out', async () => {
    stub = await startStub({
      'GET /api/v1/emailInbox/inbx_1/messages': () => ({
        status: 200,
        body: { data: { messages: [msg('old', 'x', '2026-10-11T08:00:00Z')], nextCursor: null, hasMore: false } },
      }),
    })
    const client = createPibxClient({ apiKey: KEY, baseUrl: stub.url })
    await expect(
      client.waitForMessage({ inboxId: 'inbx_1', since: '2026-10-11T10:00:00Z', pollIntervalMs: 5, timeoutMs: 40 }),
    ).rejects.toBeInstanceOf(PibxTimeoutError)
    expect(stub.requests.length).toBeGreaterThan(1)
  })

  it('rejects an unparseable since without a request', async () => {
    stub = await startStub({})
    const client = createPibxClient({ apiKey: KEY, baseUrl: stub.url })
    await expect(client.waitForMessage({ inboxId: 'inbx_1', since: 'nope', ...fast })).rejects.toThrow(TypeError)
    expect(stub.requests).toHaveLength(0)
  })

  it('turns a 200 without a messages array into PibxHttpError', async () => {
    stub = await startStub({
      'GET /api/v1/emailInbox/inbx_1/messages': () => ({ status: 200, body: { data: { messages: 'no' } } }),
    })
    const client = createPibxClient({ apiKey: KEY, baseUrl: stub.url })
    await expect(client.waitForMessage({ inboxId: 'inbx_1', since: new Date(0), ...fast })).rejects.toBeInstanceOf(
      PibxHttpError,
    )
  })
})

describe('poll interval configuration', () => {
  const never = { 'GET /api/v1/emailInbox/inbx_1/otp': () => ({ status: 404, body: {} }) }
  const wait = (client: ReturnType<typeof createPibxClient>, extra: object) =>
    client.waitForOtp({ inboxId: 'inbx_1', since: new Date(0), ...extra }).catch(() => undefined)

  it('polls every 5 seconds by default', async () => {
    stub = await startStub(never)
    const clock = fakeClock()
    await withEnv({ PIBX_POLL_INTERVAL_MS: undefined }, () =>
      wait(createPibxClient({ apiKey: KEY, baseUrl: stub!.url, clock }), { timeoutMs: 12_000 }),
    )
    expect(clock.slept).toEqual([5_000, 5_000, 2_000])
  })

  it('uses the client-level pollIntervalMs', async () => {
    stub = await startStub(never)
    const clock = fakeClock()
    await wait(createPibxClient({ apiKey: KEY, baseUrl: stub.url, clock, pollIntervalMs: 3_000 }), { timeoutMs: 7_000 })
    expect(clock.slept).toEqual([3_000, 3_000, 1_000])
  })

  it('lets a per-call pollIntervalMs override the client-level one', async () => {
    stub = await startStub(never)
    const clock = fakeClock()
    await wait(createPibxClient({ apiKey: KEY, baseUrl: stub.url, clock, pollIntervalMs: 3_000 }), {
      timeoutMs: 4_000,
      pollIntervalMs: 2_000,
    })
    expect(clock.slept).toEqual([2_000, 2_000])
  })

  it('reads PIBX_POLL_INTERVAL_MS when no option is given', async () => {
    stub = await startStub(never)
    const clock = fakeClock()
    await withEnv({ PIBX_POLL_INTERVAL_MS: '10000' }, () =>
      wait(createPibxClient({ apiKey: KEY, baseUrl: stub!.url, clock }), { timeoutMs: 20_000 }),
    )
    expect(clock.slept).toEqual([10_000, 10_000])
  })

  it.each(['abc', '0', '-5', '2.5'])('throws at construction for PIBX_POLL_INTERVAL_MS=%s', async (bad) => {
    await withEnv({ PIBX_POLL_INTERVAL_MS: bad }, () => {
      expect(() => createPibxClient({ apiKey: KEY })).toThrow(/PIBX_POLL_INTERVAL_MS/)
    })
  })
})

describe('default inbox', () => {
  const route = (id: string) => ({
    [`GET /api/v1/emailInbox/${id}/otp`]: () => ({ status: 200, body: otpBody('7', '2026-10-11T10:00:09Z') }),
  })
  const since = '2026-10-11T10:00:00Z'

  it('falls back to PIBX_INBOX_ID', async () => {
    stub = await startStub(route('inbx_env'))
    await withEnv({ PIBX_INBOX_ID: 'inbx_env' }, async () => {
      const client = createPibxClient({ apiKey: KEY, baseUrl: stub!.url })
      expect((await client.waitForOtp({ since, ...fast })).otp).toBe('7')
    })
  })

  it('prefers the client option over the env, and a per-call id over both', async () => {
    stub = await startStub({ ...route('inbx_opt'), ...route('inbx_call') })
    await withEnv({ PIBX_INBOX_ID: 'inbx_env' }, async () => {
      const client = createPibxClient({ apiKey: KEY, baseUrl: stub!.url, inboxId: 'inbx_opt' })
      await client.waitForOtp({ since, ...fast })
      await client.waitForOtp({ since, inboxId: 'inbx_call', ...fast })
    })
    expect(stub.requests.map((r) => r.path)).toEqual([
      '/api/v1/emailInbox/inbx_opt/otp',
      '/api/v1/emailInbox/inbx_call/otp',
    ])
  })

  it('throws an error naming PIBX_INBOX_ID when none is available', async () => {
    stub = await startStub({})
    await withEnv({ PIBX_INBOX_ID: undefined }, async () => {
      const client = createPibxClient({ apiKey: KEY, baseUrl: stub!.url })
      await expect(client.waitForOtp({ since, ...fast })).rejects.toThrow(/PIBX_INBOX_ID/)
    })
    expect(stub.requests).toHaveLength(0)
  })
})

describe('serverNow and otpAfter', () => {
  const DATE = 'Sun, 11 Oct 2026 10:00:00 GMT'
  const OTP_PATH = 'GET /api/v1/emailInbox/inbx_1/otp'

  it('serverNow returns the response Date header as an ISO string', async () => {
    stub = await startStub({ [OTP_PATH]: () => ({ status: 404, headers: { date: DATE }, body: {} }) })
    const client = createPibxClient({ apiKey: KEY, baseUrl: stub.url })
    expect(await client.serverNow('inbx_1')).toBe('2026-10-11T10:00:00.000Z')
    expect(stub.requests[0].query).toMatchObject({ withinMinutes: '1' })
  })

  it('serverNow throws PibxAuthError on 403', async () => {
    stub = await startStub({ [OTP_PATH]: () => ({ status: 403, body: {} }) })
    const client = createPibxClient({ apiKey: KEY, baseUrl: stub.url })
    await expect(client.serverNow('inbx_1')).rejects.toBeInstanceOf(PibxAuthError)
  })

  it('serverNow throws PibxHttpError when there is no Date header, never falling back to local time', async () => {
    const client = createPibxClient({
      apiKey: KEY,
      baseUrl: 'http://stub',
      fetch: async () => new Response('{}', { status: 404 }),
    })
    await expect(client.serverNow('inbx_1')).rejects.toBeInstanceOf(PibxHttpError)
  })

  it('otpAfter reads server time, then runs the trigger, then waits, skipping a code older than server time', async () => {
    let n = 0
    stub = await startStub({
      [OTP_PATH]: () => {
        n++
        if (n === 1) return { status: 404, headers: { date: DATE }, body: {} }
        if (n === 2) return { status: 200, body: otpBody('000000', '2026-10-11T09:59:00Z') }
        return { status: 200, body: otpBody('654321', '2026-10-11T10:00:05Z') }
      },
    })
    const client = createPibxClient({ apiKey: KEY, baseUrl: stub.url })
    let requestsAtTrigger = -1
    const res = await client.otpAfter(
      async () => {
        requestsAtTrigger = stub!.requests.length
      },
      { inboxId: 'inbx_1', ...fast },
    )
    expect(requestsAtTrigger).toBe(1)
    expect(res.otp).toBe('654321')
  })

  it('otpAfter never runs the trigger when the server-time lookup fails', async () => {
    stub = await startStub({ [OTP_PATH]: () => ({ status: 401, body: {} }) })
    const client = createPibxClient({ apiKey: KEY, baseUrl: stub.url })
    let ran = false
    await expect(
      client.otpAfter(() => { ran = true }, { inboxId: 'inbx_1', ...fast }),
    ).rejects.toBeInstanceOf(PibxAuthError)
    expect(ran).toBe(false)
  })

  it('messageAfter waits for a message created after server time', async () => {
    let n = 0
    stub = await startStub({
      [OTP_PATH]: () => ({ status: 404, headers: { date: DATE }, body: {} }),
      'GET /api/v1/emailInbox/inbx_1/messages': () => {
        n++
        const createdAt = n === 1 ? '2026-10-11T09:00:00Z' : '2026-10-11T10:00:03Z'
        return {
          status: 200,
          body: { data: { messages: [{ id: `m${n}`, subject: 'Hi', from: 'a@b.c', extractedOtp: null, createdAt }] } },
        }
      },
    })
    const client = createPibxClient({ apiKey: KEY, baseUrl: stub.url })
    const m = await client.messageAfter(() => {}, { inboxId: 'inbx_1', ...fast })
    expect(m.id).toBe('m2')
  })
})
