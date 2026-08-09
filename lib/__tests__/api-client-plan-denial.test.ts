import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { ApiError } from '@/lib/api-client'

/**
 * A 402 from `jsonPlanDenial` carries `limit`, `used` and `planCode` alongside
 * `message` (issue #117 §6b) so the client can render "1 of 1 inboxes used"
 * rather than a bare sentence.
 *
 * `handleResponse` used to build its `ApiError` from `message`/`status`/`errors`
 * only, so every one of those fields was parsed and then dropped — the richer
 * body reached the browser and died there.
 */
describe('apiClient plan-denial errors', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  function respondWith(status: number, body: unknown) {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch
  }

  async function catchError(): Promise<ApiError> {
    const { apiClient } = await import('@/lib/api-client')
    try {
      await apiClient.get('/app/emailInbox')
      throw new Error('expected the request to reject')
    } catch (error) {
      return error as ApiError
    }
  }

  it('keeps limit, used and planCode from a 402', async () => {
    respondWith(402, {
      message: 'Your Free plan allows 1 email inbox. Upgrade to add more.',
      limit: 1,
      used: 1,
      planCode: 'free',
    })

    const error = await catchError()

    expect(error.status).toBe(402)
    expect(error.limit).toBe(1)
    expect(error.used).toBe(1)
    expect(error.planCode).toBe('free')
  })

  it('still carries the message, which existing call sites read', async () => {
    respondWith(402, { message: 'Sending email is not included in your Free plan.', planCode: 'free' })

    const error = await catchError()

    expect(error.message).toBe('Sending email is not included in your Free plan.')
  })

  /**
   * A zero limit is meaningful — "none allowed" — so it must survive rather
   * than being dropped as falsy.
   */
  it('preserves a zero limit', async () => {
    respondWith(402, { message: 'Not included.', limit: 0, used: 0, planCode: 'free' })

    const error = await catchError()

    expect(error.limit).toBe(0)
  })

  it('leaves the plan fields undefined on an ordinary error', async () => {
    respondWith(400, { message: 'organizationId and email are required' })

    const error = await catchError()

    expect(error.status).toBe(400)
    expect(error.limit).toBeUndefined()
    expect(error.planCode).toBeUndefined()
  })
})
