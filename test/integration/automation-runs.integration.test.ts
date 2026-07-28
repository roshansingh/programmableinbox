import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GET as listRuns, POST as postRun } from '@/app/api/v1/automations/[id]/runs/route'
import { GET as getRun } from '@/app/api/v1/automations/[id]/runs/[runId]/route'
import { POST as replayRun } from '@/app/api/v1/automations/[id]/runs/[runId]/replay/route'
import { POST as dryRun } from '@/app/api/v1/automations/[id]/dry-run/route'
import { prisma } from '@/lib/db'
import { REPLAY_RATE_LIMITS, setReplayRateLimitClient } from '@/lib/automations/replay-rate-limit'
import { createOrgWithUser, createSecondOrg } from './helpers/auth'
import { seedAutomation, seedInbox, seedMessage } from './helpers/factories'
import { jsonRequest, params } from './helpers/request'

const NONEXISTENT_ID = '00000000-0000-7000-8000-000000000000'

// The automation seeded by `seedAutomation` (createDefaultAutomationConfig) is
// trigger(email.received) -> condition(subject contains '') -> action(send_webhook
// to https://example.com/webhook). The condition always matches (every string
// "contains" ''), so a triggered run always reaches the webhook action.
//
// lib/automations/actions.ts `executeSendWebhook` performs a REAL outbound
// request when `isDryRun` is false (POST /runs runs non-dry by default; /replay
// only when the request explicitly confirms a live replay — see issue #40).
// Since issue #39 that request goes through `safeFetch` from
// lib/security/ssrf-guard rather than global `fetch`, so the guard is what has
// to be stubbed here — no live network call happens. A dry run
// (`runAutomationDryRun`, or a replay that defaults to dry -> isDryRun: true)
// short-circuits before the call entirely, so it never touches this stub.
const { safeFetchMock } = vi.hoisted(() => ({
  safeFetchMock: vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    finalUrl: url,
    redirects: 0,
  })),
}))

vi.mock('@/lib/security/ssrf-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/ssrf-guard')>()
  return { ...actual, safeFetch: safeFetchMock }
})

// In-memory stand-in for the replay rate limiter's Redis, so these tests need no
// Redis and never hit the limiter's fail-closed path for live replays. The
// limiter's own arithmetic is covered by lib/automations/__tests__.
function createFakeRateLimitRedis() {
  const counters = new Map<string, number>()
  return {
    counters,
    async incr(key: string) {
      const next = (counters.get(key) ?? 0) + 1
      counters.set(key, next)
      return next
    },
    async expire() {
      return 1
    },
  }
}

beforeEach(() => {
  safeFetchMock.mockClear()
  setReplayRateLimitClient(createFakeRateLimitRedis())
})

afterEach(() => {
  vi.unstubAllGlobals()
  setReplayRateLimitClient(null)
})

async function setupAutomation() {
  const { org, user, token } = await createOrgWithUser()
  const inbox = await seedInbox(org.id, user.id)
  const { automation, revision } = await seedAutomation(org.id, inbox.id)
  const message = await seedMessage(inbox.id, org.id, { subject: 'Order confirmation' })
  return { org, user, token, inbox, automation, revision, message }
}

async function triggerRun(automationId: string, messageId: string, token: string) {
  const res = await postRun(
    jsonRequest(`http://localhost/api/v1/automations/${automationId}/runs`, {
      method: 'POST',
      credential: token,
      body: { emailMessageId: messageId },
    }),
    params({ id: automationId })
  )
  const json = await res.json()
  return { res, json }
}

describe('POST /api/v1/automations/[id]/runs', () => {
  it('401 without a token', async () => {
    const res = await postRun(
      jsonRequest('http://localhost/api/v1/automations/some-id/runs', { method: 'POST', body: {} }),
      params({ id: 'some-id' })
    )
    expect(res.status).toBe(401)
  })

  it('400 without emailMessageId', async () => {
    const { automation, token } = await setupAutomation()
    const res = await postRun(
      jsonRequest(`http://localhost/api/v1/automations/${automation.id}/runs`, {
        method: 'POST',
        credential: token,
        body: {},
      }),
      params({ id: automation.id })
    )
    expect(res.status).toBe(400)
  })

  it("404 when emailMessageId does not resolve inside the automation's org", async () => {
    const { automation, token } = await setupAutomation()
    const other = await createSecondOrg()
    const otherInbox = await seedInbox(other.org.id, other.user.id)
    const otherMessage = await seedMessage(otherInbox.id, other.org.id)

    const res = await postRun(
      jsonRequest(`http://localhost/api/v1/automations/${automation.id}/runs`, {
        method: 'POST',
        credential: token,
        body: { emailMessageId: otherMessage.id },
      }),
      params({ id: automation.id })
    )
    expect(res.status).toBe(404)
  })

  it("404 triggering a run on another org's automation", async () => {
    const { automation, message } = await setupAutomation()
    const other = await createSecondOrg()

    const res = await postRun(
      jsonRequest(`http://localhost/api/v1/automations/${automation.id}/runs`, {
        method: 'POST',
        credential: other.token,
        body: { emailMessageId: message.id },
      }),
      params({ id: automation.id })
    )
    expect(res.status).toBe(404)
  })

  it('creates an AutomationRun that reaches a terminal status, runs trigger→condition→action node runs, and hits the (stubbed) webhook', async () => {
    const { automation, message, token } = await setupAutomation()

    const { res, json } = await triggerRun(automation.id, message.id, token)
    expect(res.status).toBe(201)
    expect(json.data.matched).toBe(true)
    expect(json.data.status).toBe('succeeded')
    expect(json.data.runId).toBeTruthy()

    // Webhook action performed a guarded outbound call — against the stub, never live.
    expect(safeFetchMock).toHaveBeenCalledTimes(1)
    expect(safeFetchMock.mock.calls[0][0]).toBe('https://example.com/webhook')

    const run = await prisma.automationRun.findUniqueOrThrow({
      where: { id: json.data.runId },
      include: { nodeRuns: true },
    })
    expect(run.automationId).toBe(automation.id)
    expect(run.emailMessageId).toBe(message.id)
    expect(run.isDryRun).toBe(false)
    // Terminal status: not queued/running.
    expect(['succeeded', 'failed', 'partial', 'skipped']).toContain(run.status)
    expect(run.status).toBe('succeeded')
    expect(run.finishedAt).not.toBeNull()

    expect(run.nodeRuns).toHaveLength(3)
    expect(run.nodeRuns.map((n) => n.configNodeType).sort()).toEqual(['action', 'condition', 'trigger'])
    expect(run.nodeRuns.every((n) => n.status === 'succeeded')).toBe(true)
  })
})

describe('GET /api/v1/automations/[id]/runs', () => {
  it('401 without a token', async () => {
    const res = await listRuns(
      jsonRequest('http://localhost/api/v1/automations/some-id/runs'),
      params({ id: 'some-id' })
    )
    expect(res.status).toBe(401)
  })

  it('lists runs scoped to the automation, each with its node runs', async () => {
    const { automation, message, token } = await setupAutomation()
    const first = await triggerRun(automation.id, message.id, token)
    const second = await triggerRun(automation.id, message.id, token)

    const res = await listRuns(
      jsonRequest(`http://localhost/api/v1/automations/${automation.id}/runs`, { credential: token }),
      params({ id: automation.id })
    )
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(Array.isArray(data)).toBe(true)
    expect(data).toHaveLength(2)
    const ids = data.map((r: { id: string }) => r.id).sort()
    expect(ids).toEqual([first.json.data.runId, second.json.data.runId].sort())
    for (const run of data) {
      expect(run.nodeRuns).toHaveLength(3)
      expect(run.isDryRun).toBe(false)
    }
  })

  it("does not list another automation's runs, even within the same org", async () => {
    const { org, user, token } = await createOrgWithUser()
    const inbox = await seedInbox(org.id, user.id)
    const { automation: automationA } = await seedAutomation(org.id, inbox.id)
    const { automation: automationB } = await seedAutomation(org.id, inbox.id)
    const message = await seedMessage(inbox.id, org.id)
    await triggerRun(automationA.id, message.id, token)

    const res = await listRuns(
      jsonRequest(`http://localhost/api/v1/automations/${automationB.id}/runs`, { credential: token }),
      params({ id: automationB.id })
    )
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data).toHaveLength(0)
  })

  it("404 listing another org's automation runs", async () => {
    const { automation } = await setupAutomation()
    const other = await createSecondOrg()

    const res = await listRuns(
      jsonRequest(`http://localhost/api/v1/automations/${automation.id}/runs`, { credential: other.token }),
      params({ id: automation.id })
    )
    expect(res.status).toBe(404)
  })
})

describe('GET /api/v1/automations/[id]/runs/[runId]', () => {
  it('401 without a token', async () => {
    const res = await getRun(
      jsonRequest('http://localhost/api/v1/automations/some-id/runs/some-run'),
      params({ id: 'some-id', runId: 'some-run' })
    )
    expect(res.status).toBe(401)
  })

  it('gets a run with full node-run detail (input/output/error)', async () => {
    const { automation, message, token } = await setupAutomation()
    const { json } = await triggerRun(automation.id, message.id, token)

    const res = await getRun(
      jsonRequest(`http://localhost/api/v1/automations/${automation.id}/runs/${json.data.runId}`, {
        credential: token,
      }),
      params({ id: automation.id, runId: json.data.runId })
    )
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.id).toBe(json.data.runId)
    expect(data.status).toBe('succeeded')
    expect(data.emailMessageId).toBe(message.id)
    expect(data.nodeRuns).toHaveLength(3)

    const actionNodeRun = data.nodeRuns.find((n: { configNodeType: string }) => n.configNodeType === 'action')
    expect(actionNodeRun.status).toBe('succeeded')
    expect(actionNodeRun.output).toEqual({ status: 200, url: 'https://example.com/webhook' })
    expect(actionNodeRun.input).toBeTruthy()
    expect(actionNodeRun.error).toBeNull()
  })

  it('404 for a nonexistent runId under a real automation', async () => {
    const { automation, token } = await setupAutomation()
    const res = await getRun(
      jsonRequest(`http://localhost/api/v1/automations/${automation.id}/runs/${NONEXISTENT_ID}`, {
        credential: token,
      }),
      params({ id: automation.id, runId: NONEXISTENT_ID })
    )
    expect(res.status).toBe(404)
  })

  it("404 for a run that belongs to a different automation (foreign run)", async () => {
    const { org, user, token } = await createOrgWithUser()
    const inbox = await seedInbox(org.id, user.id)
    const { automation: automationA } = await seedAutomation(org.id, inbox.id)
    const { automation: automationB } = await seedAutomation(org.id, inbox.id)
    const message = await seedMessage(inbox.id, org.id)
    const { json } = await triggerRun(automationA.id, message.id, token)

    const res = await getRun(
      jsonRequest(`http://localhost/api/v1/automations/${automationB.id}/runs/${json.data.runId}`, {
        credential: token,
      }),
      params({ id: automationB.id, runId: json.data.runId })
    )
    expect(res.status).toBe(404)
  })

  it("404 for a run under another org's automation", async () => {
    const { automation, message, token } = await setupAutomation()
    const { json } = await triggerRun(automation.id, message.id, token)
    const other = await createSecondOrg()

    const res = await getRun(
      jsonRequest(`http://localhost/api/v1/automations/${automation.id}/runs/${json.data.runId}`, {
        credential: other.token,
      }),
      params({ id: automation.id, runId: json.data.runId })
    )
    expect(res.status).toBe(404)
  })
})

describe('POST /api/v1/automations/[id]/runs/[runId]/replay', () => {
  it('401 without a token', async () => {
    const res = await replayRun(
      jsonRequest('http://localhost/api/v1/automations/some-id/runs/some-run/replay', { method: 'POST' }),
      params({ id: 'some-id', runId: 'some-run' })
    )
    expect(res.status).toBe(401)
  })

  it('defaults to a DRY RUN — no side effect — even when the original run was live (#40)', async () => {
    const { automation, message, token } = await setupAutomation()
    const { json: original } = await triggerRun(automation.id, message.id, token)
    expect(safeFetchMock).toHaveBeenCalledTimes(1)

    const originalRun = await prisma.automationRun.findUniqueOrThrow({
      where: { id: original.data.runId },
    })
    expect(originalRun.isDryRun).toBe(false)

    const res = await replayRun(
      jsonRequest(`http://localhost/api/v1/automations/${automation.id}/runs/${original.data.runId}/replay`, {
        method: 'POST',
        credential: token,
      }),
      params({ id: automation.id, runId: original.data.runId })
    )
    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data.runId).not.toBe(original.data.runId)
    expect(data.isDryRun).toBe(true)
    expect(data.mode).toBe('dry_run')

    // No second webhook call: the replay defaulted to dry-run and did not
    // re-fire the side effect.
    expect(safeFetchMock).toHaveBeenCalledTimes(1)

    const replayedRun = await prisma.automationRun.findUniqueOrThrow({ where: { id: data.runId } })
    expect(replayedRun.automationId).toBe(automation.id)
    expect(replayedRun.emailMessageId).toBe(message.id)
    expect(replayedRun.isDryRun).toBe(true)

    const totalRuns = await prisma.automationRun.count({ where: { automationId: automation.id } })
    expect(totalRuns).toBe(2)
  })

  it('400 for a live replay without explicit confirmation, and nothing runs', async () => {
    const { automation, message, token } = await setupAutomation()
    const { json: original } = await triggerRun(automation.id, message.id, token)

    const res = await replayRun(
      jsonRequest(`http://localhost/api/v1/automations/${automation.id}/runs/${original.data.runId}/replay`, {
        method: 'POST',
        credential: token,
        body: { mode: 'live' },
      }),
      params({ id: automation.id, runId: original.data.runId })
    )
    expect(res.status).toBe(400)
    expect(safeFetchMock).toHaveBeenCalledTimes(1)
    const totalRuns = await prisma.automationRun.count({ where: { automationId: automation.id } })
    expect(totalRuns).toBe(1)
  })

  it('re-executes the real side effect only for an explicitly confirmed live replay', async () => {
    const { automation, message, token } = await setupAutomation()
    const { json: original } = await triggerRun(automation.id, message.id, token)
    expect(safeFetchMock).toHaveBeenCalledTimes(1)

    const res = await replayRun(
      jsonRequest(`http://localhost/api/v1/automations/${automation.id}/runs/${original.data.runId}/replay`, {
        method: 'POST',
        credential: token,
        body: { mode: 'live', confirm: true },
      }),
      params({ id: automation.id, runId: original.data.runId })
    )
    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data.isDryRun).toBe(false)
    expect(safeFetchMock).toHaveBeenCalledTimes(2)

    const replayedRun = await prisma.automationRun.findUniqueOrThrow({ where: { id: data.runId } })
    expect(replayedRun.isDryRun).toBe(false)
    expect(replayedRun.emailMessageId).toBe(message.id)
  })

  it('rate limits repeated live replays (429) once the per-user budget is spent', async () => {
    const { automation, message, token } = await setupAutomation()
    const { json: original } = await triggerRun(automation.id, message.id, token)

    const liveBudget = REPLAY_RATE_LIMITS.live.user.limit
    const statuses: number[] = []
    for (let i = 0; i < liveBudget + 2; i += 1) {
      const res = await replayRun(
        jsonRequest(`http://localhost/api/v1/automations/${automation.id}/runs/${original.data.runId}/replay`, {
          method: 'POST',
          credential: token,
          body: { mode: 'live', confirm: true },
        }),
        params({ id: automation.id, runId: original.data.runId })
      )
      statuses.push(res.status)
    }

    expect(statuses.filter((s) => s === 201)).toHaveLength(liveBudget)
    expect(statuses.slice(-2)).toEqual([429, 429])
    // 1 original trigger + `liveBudget` accepted live replays.
    expect(safeFetchMock).toHaveBeenCalledTimes(1 + liveBudget)
  })

  it('404 for a nonexistent runId', async () => {
    const { automation, token } = await setupAutomation()
    const res = await replayRun(
      jsonRequest(`http://localhost/api/v1/automations/${automation.id}/runs/${NONEXISTENT_ID}/replay`, {
        method: 'POST',
        credential: token,
      }),
      params({ id: automation.id, runId: NONEXISTENT_ID })
    )
    expect(res.status).toBe(404)
  })

  it("404 replaying a run under another org's automation", async () => {
    const { automation, message, token } = await setupAutomation()
    const { json } = await triggerRun(automation.id, message.id, token)
    const other = await createSecondOrg()

    const res = await replayRun(
      jsonRequest(`http://localhost/api/v1/automations/${automation.id}/runs/${json.data.runId}/replay`, {
        method: 'POST',
        credential: other.token,
      }),
      params({ id: automation.id, runId: json.data.runId })
    )
    expect(res.status).toBe(404)

    // No replay run was created for the rejected cross-tenant call.
    const totalRuns = await prisma.automationRun.count({ where: { automationId: automation.id } })
    expect(totalRuns).toBe(1)
  })
})

describe('POST /api/v1/automations/[id]/dry-run', () => {
  it('401 without a token', async () => {
    const res = await dryRun(
      jsonRequest('http://localhost/api/v1/automations/some-id/dry-run', { method: 'POST', body: {} }),
      params({ id: 'some-id' })
    )
    expect(res.status).toBe(401)
  })

  it(
    'dry-runs over recent messages, persists an isDryRun AutomationRun audit row per message, ' +
      'but skips the actual webhook side effect (no fetch call, no non-dry AutomationRun)',
    async () => {
      const { automation, inbox, org, token, message } = await setupAutomation()
      // A second message in the same inbox so the dry-run sweep covers >1 message.
      const secondMessage = await seedMessage(inbox.id, org.id, { subject: 'Second message' })

      const res = await dryRun(
        jsonRequest(`http://localhost/api/v1/automations/${automation.id}/dry-run`, {
          method: 'POST',
          credential: token,
          body: {},
        }),
        params({ id: automation.id })
      )
      expect(res.status).toBe(200)
      const { data } = await res.json()
      expect(Array.isArray(data)).toBe(true)
      // The automation's own seeded message plus the second one.
      expect(data).toHaveLength(2)
      for (const result of data) {
        expect(result.matched).toBe(true)
        // The condition always matches, but the send_webhook action reports
        // "skipped" under isDryRun (see actions.ts executeSendWebhook), and a
        // skipped-but-matched run still finishes as 'succeeded' overall.
        expect(result.status).toBe('succeeded')
      }

      // No real network call was made for the webhook action.
      expect(safeFetchMock).not.toHaveBeenCalled()

      // Dry-run persistence semantics (confirmed by reading executeAutomation /
      // runAutomationDryRun / executeSendWebhook): executeAutomation ALWAYS
      // writes an AutomationRun + AutomationNodeRun audit trail, dry or not.
      // "No side-effect persistence" refers to the action layer: with
      // isDryRun true, executeSendWebhook returns early with a `skipped`
      // result and never calls fetch, so no outbound webhook (the
      // side-effect) is attempted. Assert both halves precisely: two dry
      // AutomationRun rows were written, and zero non-dry ones exist.
      const dryRuns = await prisma.automationRun.findMany({
        where: { automationId: automation.id, isDryRun: true },
        include: { nodeRuns: true },
      })
      expect(dryRuns).toHaveLength(2)
      for (const run of dryRuns) {
        const actionNodeRun = run.nodeRuns.find((n) => n.configNodeType === 'action')
        expect(actionNodeRun?.status).toBe('skipped')
        expect(actionNodeRun?.output).toEqual({ dryRun: true, url: 'https://example.com/webhook', method: 'POST' })
      }

      const dryRunMessageIds = dryRuns.map((r) => r.emailMessageId).sort()
      expect(dryRunMessageIds).toEqual([message.id, secondMessage.id].sort())

      const nonDryRuns = await prisma.automationRun.count({
        where: { automationId: automation.id, isDryRun: false },
      })
      expect(nonDryRuns).toBe(0)
    }
  )

  it("404 dry-running another org's automation", async () => {
    const { automation } = await setupAutomation()
    const other = await createSecondOrg()

    const res = await dryRun(
      jsonRequest(`http://localhost/api/v1/automations/${automation.id}/dry-run`, {
        method: 'POST',
        credential: other.token,
        body: {},
      }),
      params({ id: automation.id })
    )
    expect(res.status).toBe(404)
  })
})
