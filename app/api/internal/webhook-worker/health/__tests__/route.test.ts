import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock the worker module so tests never create real Redis connections.
// ---------------------------------------------------------------------------

const mockIsPaused = vi.fn()

vi.mock('@/lib/webhooks/worker', () => ({
  getEmailWebhookWorker: () => ({
    isPaused: () => mockIsPaused() as boolean,
  }),
}))

async function loadRoute() {
  return await import('../route')
}

describe('GET /api/internal/webhook-worker/health', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // Ensure env var is set for most tests
    process.env.ENABLE_ASYNC_WEBHOOK_PROCESSING = 'true'
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('returns 503 when async webhook processing is disabled', async () => {
    process.env.ENABLE_ASYNC_WEBHOOK_PROCESSING = 'false'

    const { GET } = await loadRoute()
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.message).toContain('disabled')
  })

  it('returns 200 with status healthy when the worker is running', async () => {
    mockIsPaused.mockReturnValue(false as boolean)

    const { GET } = await loadRoute()
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.status).toBe('healthy')
    expect(body.data.worker).toBe('running')
    expect(body.data.timestamp).toBeDefined()
  })

  it('returns 503 when the worker is paused', async () => {
    mockIsPaused.mockReturnValue(true as boolean)

    const { GET } = await loadRoute()
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.message).toContain('paused')
  })

  it('returns 503 with error message when getEmailWebhookWorker throws', async () => {
    vi.resetModules()
    vi.doMock('@/lib/webhooks/worker', () => ({
      getEmailWebhookWorker: () => {
        throw new Error('Redis connection refused')
      },
    }))

    const { GET } = await loadRoute()
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.message).toContain('Redis connection refused')
  })
})
