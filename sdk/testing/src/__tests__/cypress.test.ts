import { afterEach, describe, expect, it } from 'vitest'
import { startStub } from '../../test-support/stub-server.mjs'
import { pibxTasks } from '../cypress/index.js'

type Stub = Awaited<ReturnType<typeof startStub>>
let stub: Stub | undefined
afterEach(async () => {
  await stub?.close()
  stub = undefined
})

function register(config: { env: Record<string, unknown> }) {
  let tasks: Record<string, (arg: any) => unknown> = {}
  pibxTasks((_event, t) => { tasks = t }, config)
  return tasks
}

const DATE = 'Sun, 11 Oct 2026 10:00:00 GMT'
const otpRoute = (id: string) => ({
  [`GET /api/v1/emailInbox/${id}/otp`]: () => ({
    status: 200,
    headers: { date: DATE },
    body: {
      data: {
        otp: '135790',
        message: { id: 'm', subject: 's', from: 'f', extractedOtp: '135790', createdAt: '2026-10-11T10:00:05Z' },
      },
    },
  }),
})

describe('pibxTasks', () => {
  it('registers the four tasks', () => {
    const tasks = register({ env: { PIBX_API_KEY: 'sk_live_x' } })
    expect(Object.keys(tasks).sort()).toEqual([
      'pibx:createInbox',
      'pibx:now',
      'pibx:waitForMessage',
      'pibx:waitForOtp',
    ])
  })

  it('pibx:now returns the server time as ISO, using the inbox from config.env', async () => {
    stub = await startStub(otpRoute('inbx_cfg'))
    const tasks = register({
      env: { PIBX_API_KEY: 'sk_live_cfg', PIBX_BASE_URL: stub.url, PIBX_INBOX_ID: 'inbx_cfg' },
    })
    expect(await tasks['pibx:now'](null)).toBe('2026-10-11T10:00:00.000Z')
  })

  it('pibx:now prefers an inboxId in its argument', async () => {
    stub = await startStub(otpRoute('inbx_arg'))
    const tasks = register({
      env: { PIBX_API_KEY: 'sk_live_cfg', PIBX_BASE_URL: stub.url, PIBX_INBOX_ID: 'inbx_cfg' },
    })
    await tasks['pibx:now']({ inboxId: 'inbx_arg' })
    expect(stub.requests[0].path).toBe('/api/v1/emailInbox/inbx_arg/otp')
  })

  it('reads key and base URL from config.env and returns just the code string', async () => {
    stub = await startStub(otpRoute('inbx_1'))
    const tasks = register({ env: { PIBX_API_KEY: 'sk_live_cfg', PIBX_BASE_URL: stub.url } })
    const code = await tasks['pibx:waitForOtp']({
      inboxId: 'inbx_1',
      since: '2026-01-01T00:00:00Z',
      pollIntervalMs: 5,
      timeoutMs: 200,
    })
    expect(code).toBe('135790')
    expect(stub.requests[0].headers.authorization).toBe('Bearer sk_live_cfg')
  })

  it('removes the API key from config.env so Cypress does not ship it to the browser', async () => {
    stub = await startStub(otpRoute('inbx_1'))
    const config = { env: { PIBX_API_KEY: 'sk_live_secret', PIBX_BASE_URL: stub.url } }
    const tasks = register(config)
    // config.env is serialised to the browser (Cypress.env(), the Settings
    // panel, the command log); the key must be gone before that happens.
    expect(config.env.PIBX_API_KEY).toBeUndefined()
    // ...yet the Node-side tasks still authenticate with it.
    await tasks['pibx:waitForOtp']({ inboxId: 'inbx_1', since: '2026-01-01T00:00:00Z', timeoutMs: 200 })
    expect(stub.requests[0].headers.authorization).toBe('Bearer sk_live_secret')
  })

  it('defers the missing-key error to the first task call, not config load', async () => {
    const prev = process.env.PIBX_API_KEY
    delete process.env.PIBX_API_KEY
    try {
      const tasks = register({ env: {} }) // must not throw: cypress.config.ts loads for every command
      await expect(
        Promise.resolve().then(() => tasks['pibx:waitForOtp']({ inboxId: 'i', since: new Date(0).toISOString() })),
      ).rejects.toThrow(/PIBX_API_KEY/)
    } finally {
      if (prev !== undefined) process.env.PIBX_API_KEY = prev
    }
  })

  it('rejects an invalid PIBX_POLL_INTERVAL_MS from config.env at the first task call', async () => {
    const tasks = register({ env: { PIBX_API_KEY: 'sk_live_x', PIBX_POLL_INTERVAL_MS: 'abc' } })
    await expect(
      Promise.resolve().then(() => tasks['pibx:waitForOtp']({ inboxId: 'i', since: new Date(0).toISOString() })),
    ).rejects.toThrow(/PIBX_POLL_INTERVAL_MS/)
  })

  it('accepts a numeric PIBX_POLL_INTERVAL_MS (Cypress coerces numeric env values)', async () => {
    stub = await startStub(otpRoute('inbx_1'))
    const tasks = register({
      env: { PIBX_API_KEY: 'sk_live_x', PIBX_BASE_URL: stub.url, PIBX_POLL_INTERVAL_MS: 2500 },
    })
    expect(
      await tasks['pibx:waitForOtp']({ inboxId: 'inbx_1', since: '2026-01-01T00:00:00Z', timeoutMs: 200 }),
    ).toBe('135790')
  })
})
