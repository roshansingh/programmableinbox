/**
 * Route tests for POST /api/app/automations/[id]/runs/[runId]/replay
 * (security issue #40).
 *
 * The invariant under test: replay NEVER re-executes real side effects unless
 * the request itself asks for it, and never because the stored run happened to
 * be live. Prisma, auth, the executor and the rate limiter are mocked, so the
 * assertions are about the route's decision logic only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveUserPrincipalFromTokenMock = vi.fn()
const automationFindFirstMock = vi.fn()
const automationRunFindFirstMock = vi.fn()
const automationRunFindUniqueMock = vi.fn()
const executeAutomationMock = vi.fn()
const consumeReplayRateLimitMock = vi.fn()

vi.mock('@/lib/auth-server', () => ({
  resolveUserPrincipalFromToken: (...args: unknown[]) =>
    resolveUserPrincipalFromTokenMock(...args),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    automation: {
      findFirst: (...args: unknown[]) => automationFindFirstMock(...args),
    },
    automationRun: {
      findFirst: (...args: unknown[]) => automationRunFindFirstMock(...args),
      findUnique: (...args: unknown[]) => automationRunFindUniqueMock(...args),
    },
  },
}))

// The dispatcher is exercised for real so the isDryRun flag it forwards is
// observable; only the executor underneath it is stubbed.
vi.mock('@/lib/automations/executor', () => ({
  executeAutomation: (...args: unknown[]) => executeAutomationMock(...args),
}))

vi.mock('@/lib/automations/replay-rate-limit', () => ({
  consumeReplayRateLimit: (...args: unknown[]) => consumeReplayRateLimitMock(...args),
}))

async function loadRoute() {
  return await import('../route')
}

function replayRequest(body?: unknown, { credential = 'Bearer token' } = {}) {
  return new Request('http://localhost/api/app/automations/automation_1/runs/run_1/replay', {
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      'content-type': 'application/json',
      ...(credential ? { authorization: credential } : {}),
    },
  }) as never
}

const routeParams = { params: Promise.resolve({ id: 'automation_1', runId: 'run_1' }) }

/** The original run was LIVE — the flag that used to be inherited. */
const ORIGINAL_LIVE_RUN = {
  id: 'run_1',
  automationId: 'automation_1',
  isDryRun: false,
  emailMessageId: 'message_1',
}

describe('POST /api/app/automations/[id]/runs/[runId]/replay', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    resolveUserPrincipalFromTokenMock.mockResolvedValue({
      kind: 'user',
      userId: 'user_1',
      memberships: [{ organizationId: 'org_1' }],
    })
    automationFindFirstMock.mockResolvedValue({
      id: 'automation_1',
      organizationId: 'org_1',
      activeRevision: { id: 'rev_1' },
    })
    automationRunFindFirstMock.mockResolvedValue(ORIGINAL_LIVE_RUN)
    automationRunFindUniqueMock.mockResolvedValue({
      ...ORIGINAL_LIVE_RUN,
      automation: { id: 'automation_1', name: 'Test', organizationId: 'org_1' },
      automationRevision: { id: 'rev_1', revision: 1, config: {}, layout: {} },
      emailMessage: {
        id: 'message_1',
        inboxEmailAddress: { id: 'inbox_1', email: 'a@b.test' },
        attachments: [],
      },
    })
    executeAutomationMock.mockResolvedValue({ matched: true, status: 'succeeded', runId: 'run_2' })
    consumeReplayRateLimitMock.mockResolvedValue({ allowed: true })
  })

  describe('dry-run default', () => {
    it('replays as a DRY RUN with no body, even though the original run was live', async () => {
      const { POST } = await loadRoute()
      const response = await POST(replayRequest(), routeParams)
      const body = await response.json()

      expect(response.status).toBe(201)
      expect(body.data.isDryRun).toBe(true)
      expect(body.data.mode).toBe('dry_run')
      expect(executeAutomationMock).toHaveBeenCalledTimes(1)
      expect(executeAutomationMock.mock.calls[0][0]).toMatchObject({ isDryRun: true })
    })

    it('replays as a dry run for an explicit { mode: "dry_run" }', async () => {
      const { POST } = await loadRoute()
      const response = await POST(replayRequest({ mode: 'dry_run' }), routeParams)

      expect(response.status).toBe(201)
      expect(executeAutomationMock.mock.calls[0][0]).toMatchObject({ isDryRun: true })
    })

    it('does not consult the stored run isDryRun flag to decide liveness', async () => {
      automationRunFindFirstMock.mockResolvedValue({ ...ORIGINAL_LIVE_RUN, isDryRun: false })
      const { POST } = await loadRoute()
      await POST(replayRequest({}), routeParams)

      expect(executeAutomationMock.mock.calls[0][0]).toMatchObject({ isDryRun: true })
    })
  })

  describe('live replay requires explicit confirmation', () => {
    it('rejects { mode: "live" } without confirm', async () => {
      const { POST } = await loadRoute()
      const response = await POST(replayRequest({ mode: 'live' }), routeParams)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.message).toMatch(/explicit confirmation/i)
      expect(executeAutomationMock).not.toHaveBeenCalled()
    })

    it('rejects a non-boolean-true confirm', async () => {
      const { POST } = await loadRoute()
      const response = await POST(replayRequest({ mode: 'live', confirm: 'true' }), routeParams)

      expect(response.status).toBe(400)
      expect(executeAutomationMock).not.toHaveBeenCalled()
    })

    it('rejects the legacy isDryRun flag instead of silently downgrading', async () => {
      const { POST } = await loadRoute()
      const response = await POST(replayRequest({ isDryRun: false }), routeParams)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.message).toMatch(/isDryRun is not accepted/i)
      expect(executeAutomationMock).not.toHaveBeenCalled()
    })

    it('rejects an unknown mode', async () => {
      const { POST } = await loadRoute()
      const response = await POST(replayRequest({ mode: 'LIVE' }), routeParams)

      expect(response.status).toBe(400)
      expect(executeAutomationMock).not.toHaveBeenCalled()
    })

    it('rejects an explicit null mode rather than defaulting it', async () => {
      // `{ mode: null }` means the caller passed a variable that did not hold
      // what they thought. Defaulting it to dry_run would hide that bug.
      const { POST } = await loadRoute()
      const response = await POST(replayRequest({ mode: null }), routeParams)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.message).toMatch(/mode must be/i)
      expect(executeAutomationMock).not.toHaveBeenCalled()
    })

    it('runs live only for { mode: "live", confirm: true }', async () => {
      const { POST } = await loadRoute()
      const response = await POST(replayRequest({ mode: 'live', confirm: true }), routeParams)
      const body = await response.json()

      expect(response.status).toBe(201)
      expect(body.data.isDryRun).toBe(false)
      expect(body.data.mode).toBe('live')
      expect(executeAutomationMock.mock.calls[0][0]).toMatchObject({ isDryRun: false })
      expect(consumeReplayRateLimitMock).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'live', userId: 'user_1', automationId: 'automation_1' })
      )
    })
  })

  describe('rate limiting', () => {
    it('returns 429 with Retry-After once the budget is exhausted, without executing', async () => {
      consumeReplayRateLimitMock.mockResolvedValue({
        allowed: false,
        reason: 'limit_exceeded',
        scope: 'user',
        limit: 5,
        windowSeconds: 60,
        retryAfterSeconds: 42,
      })

      const { POST } = await loadRoute()
      const response = await POST(replayRequest({ mode: 'live', confirm: true }), routeParams)
      const body = await response.json()

      expect(response.status).toBe(429)
      expect(response.headers.get('Retry-After')).toBe('42')
      expect(body.message).toMatch(/rate limit exceeded/i)
      expect(executeAutomationMock).not.toHaveBeenCalled()
    })

    it('rate limits repeated replays: the Nth call over budget is rejected', async () => {
      // Simulate a real fixed-window budget of 2 live replays.
      let used = 0
      consumeReplayRateLimitMock.mockImplementation(async () => {
        used += 1
        return used <= 2
          ? { allowed: true }
          : {
              allowed: false,
              reason: 'limit_exceeded' as const,
              scope: 'automation' as const,
              limit: 2,
              windowSeconds: 60,
              retryAfterSeconds: 30,
            }
      })

      const { POST } = await loadRoute()
      const statuses: number[] = []
      for (let i = 0; i < 4; i += 1) {
        const response = await POST(replayRequest({ mode: 'live', confirm: true }), routeParams)
        statuses.push(response.status)
      }

      expect(statuses).toEqual([201, 201, 429, 429])
      expect(executeAutomationMock).toHaveBeenCalledTimes(2)
    })

    it('is enforced on dry-run replays too', async () => {
      consumeReplayRateLimitMock.mockResolvedValue({
        allowed: false,
        reason: 'limit_exceeded',
        scope: 'automation',
        limit: 60,
        windowSeconds: 60,
        retryAfterSeconds: 7,
      })

      const { POST } = await loadRoute()
      const response = await POST(replayRequest(), routeParams)

      expect(response.status).toBe(429)
      expect(executeAutomationMock).not.toHaveBeenCalled()
    })

    it('is consumed only after auth and tenant scoping succeed', async () => {
      automationFindFirstMock.mockResolvedValue(null)
      const { POST } = await loadRoute()
      const response = await POST(replayRequest(), routeParams)

      expect(response.status).toBe(404)
      expect(consumeReplayRateLimitMock).not.toHaveBeenCalled()
    })
  })

  describe('Redis outage handling', () => {
    it('fails CLOSED for a live replay when the limiter is unavailable (503)', async () => {
      consumeReplayRateLimitMock.mockResolvedValue({ allowed: false, reason: 'unavailable' })

      const { POST } = await loadRoute()
      const response = await POST(replayRequest({ mode: 'live', confirm: true }), routeParams)

      expect(response.status).toBe(503)
      expect(executeAutomationMock).not.toHaveBeenCalled()
    })

    it('fails OPEN for a dry-run replay when the limiter is unavailable', async () => {
      consumeReplayRateLimitMock.mockResolvedValue({ allowed: false, reason: 'unavailable' })

      const { POST } = await loadRoute()
      const response = await POST(replayRequest(), routeParams)
      const body = await response.json()

      expect(response.status).toBe(201)
      expect(body.data.isDryRun).toBe(true)
      expect(executeAutomationMock.mock.calls[0][0]).toMatchObject({ isDryRun: true })
    })
  })

  describe('authorization', () => {
    it('401 without a token, without touching the rate limiter or executor', async () => {
      resolveUserPrincipalFromTokenMock.mockResolvedValue(null)
      const { POST } = await loadRoute()
      const response = await POST(replayRequest({ mode: 'live', confirm: true }, { credential: '' }), routeParams)

      expect(response.status).toBe(401)
      expect(consumeReplayRateLimitMock).not.toHaveBeenCalled()
      expect(executeAutomationMock).not.toHaveBeenCalled()
    })

    it("404 for an automation outside the caller's organizations", async () => {
      automationFindFirstMock.mockResolvedValue(null)
      const { POST } = await loadRoute()
      const response = await POST(replayRequest({ mode: 'live', confirm: true }), routeParams)

      expect(response.status).toBe(404)
      expect(executeAutomationMock).not.toHaveBeenCalled()
    })

    it('404 for a run that does not belong to the automation', async () => {
      automationRunFindFirstMock.mockResolvedValue(null)
      const { POST } = await loadRoute()
      const response = await POST(replayRequest({ mode: 'live', confirm: true }), routeParams)

      expect(response.status).toBe(404)
      expect(executeAutomationMock).not.toHaveBeenCalled()
    })
  })
})
