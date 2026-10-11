import { afterEach, describe, expect, it } from 'vitest'
import { startStub } from '../../test-support/stub-server.mjs'
import { pibxFixtures } from '../playwright/index.js'

type Stub = Awaited<ReturnType<typeof startStub>>
let stub: Stub | undefined
afterEach(async () => {
  await stub?.close()
  stub = undefined
})

// Playwright option fixtures are [value, options] tuples; fixtures are plain
// async functions. Exercise the function directly with a fake `use`.
async function resolvePibx(deps: { pibxApiKey?: string; pibxBaseUrl?: string; pibxInboxId?: string }) {
  let value: any
  await (pibxFixtures.pibx as any)(deps, async (v: unknown) => { value = v })
  return value
}

describe('pibxFixtures', () => {
  it('declares the key, base URL and inbox as options defaulting to undefined', () => {
    expect(pibxFixtures.pibxApiKey).toEqual([undefined, { option: true }])
    expect(pibxFixtures.pibxBaseUrl).toEqual([undefined, { option: true }])
    expect(pibxFixtures.pibxInboxId).toEqual([undefined, { option: true }])
  })

  it('builds a client from the option fixtures', async () => {
    stub = await startStub({
      'POST /api/v1/emailInbox': () => ({
        status: 201,
        body: { data: { id: 'inbx_9', email: 'e@x.dev', name: null, createdAt: 'z' } },
      }),
    })
    const pibx = await resolvePibx({ pibxApiKey: 'sk_live_pw', pibxBaseUrl: stub.url })
    const inbox = await pibx.createInbox({ email: 'e@x.dev' })
    expect(inbox.id).toBe('inbx_9')
    expect(stub.requests[0].headers.authorization).toBe('Bearer sk_live_pw')
  })

  it('otpAfter uses the pibxInboxId option and server time', async () => {
    stub = await startStub({
      'GET /api/v1/emailInbox/inbx_pw/messages': () => ({
        status: 200,
        headers: { date: 'Sun, 11 Oct 2026 10:00:00 GMT' },
        body: { data: { messages: [], nextCursor: null, hasMore: false } },
      }),
      'GET /api/v1/emailInbox/inbx_pw/otp': () => ({
        status: 200,
        body: {
          data: {
            otp: '246810',
            message: { id: 'm', subject: 's', from: 'f', extractedOtp: '246810', createdAt: '2026-10-11T10:00:04Z' },
          },
        },
      }),
    })
    const pibx = await resolvePibx({ pibxApiKey: 'sk_live_pw', pibxBaseUrl: stub.url, pibxInboxId: 'inbx_pw' })
    let triggered = false
    const { otp } = await pibx.otpAfter(() => { triggered = true }, { pollIntervalMs: 5, timeoutMs: 400 })
    expect(triggered).toBe(true)
    expect(otp).toBe('246810')
  })
})
