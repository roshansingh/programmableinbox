import { describe, it, expect } from 'vitest'
import { POST as sweepStuckRuns } from '@/app/api/cron/sweep-stuck-runs/route'
import { GET as healthz } from '@/app/api/healthz/route'
import { GET as docs } from '@/app/api/docs/route'
import { GET as workerHealth } from '@/app/api/internal/webhook-worker/health/route'
import { prisma } from '@/lib/db'
import { AutomationRunStatus } from '@/lib/generated/prisma/client'
import { createOrgWithUser } from './helpers/auth'
import { seedAutomation } from './helpers/factories'
import { jsonRequest } from './helpers/request'

describe('POST /api/cron/sweep-stuck-runs', () => {
  it('401 without the sweeper secret header', async () => {
    const res = await sweepStuckRuns(
      jsonRequest('http://localhost/api/cron/sweep-stuck-runs', { method: 'POST' })
    )
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.message).toBeTruthy()
  })

  it('401 with the wrong sweeper secret header', async () => {
    const res = await sweepStuckRuns(
      jsonRequest('http://localhost/api/cron/sweep-stuck-runs', {
        method: 'POST',
        headers: { 'x-automation-sweeper-secret': 'wrong-secret' },
      })
    )
    expect(res.status).toBe(401)
  })

  it('sweeps a stuck (running, old startedAt) run to failed and returns the count', async () => {
    const { org } = await createOrgWithUser()
    const { automation, revision } = await seedAutomation(org.id)
    const staleStartedAt = new Date(Date.now() - 30 * 60 * 1000) // 30 min ago, older than the 15 min cutoff

    const stuckRun = await prisma.automationRun.create({
      data: {
        automationId: automation.id,
        automationRevisionId: revision.id,
        organizationId: org.id,
        triggerType: 'email.received',
        status: AutomationRunStatus.running,
        inputSnapshot: {},
        startedAt: staleStartedAt,
      },
    })

    // A fresh (not stuck) run of the same automation to confirm it's untouched.
    const freshRun = await prisma.automationRun.create({
      data: {
        automationId: automation.id,
        automationRevisionId: revision.id,
        organizationId: org.id,
        triggerType: 'email.received',
        status: AutomationRunStatus.queued,
        inputSnapshot: {},
        startedAt: new Date(),
      },
    })

    const res = await sweepStuckRuns(
      jsonRequest('http://localhost/api/cron/sweep-stuck-runs', {
        method: 'POST',
        headers: { 'x-automation-sweeper-secret': process.env.AUTOMATION_SWEEPER_SECRET! },
      })
    )
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.count).toBeGreaterThanOrEqual(1)

    const sweptRun = await prisma.automationRun.findUniqueOrThrow({ where: { id: stuckRun.id } })
    expect(sweptRun.status).toBe(AutomationRunStatus.failed)
    expect(sweptRun.finishedAt).not.toBeNull()
    expect(sweptRun.error).toEqual({ message: 'Marked failed by stuck-run sweeper' })

    const untouchedRun = await prisma.automationRun.findUniqueOrThrow({ where: { id: freshRun.id } })
    expect(untouchedRun.status).toBe(AutomationRunStatus.queued)
    expect(untouchedRun.finishedAt).toBeNull()
  })
})

describe('GET /api/healthz', () => {
  it('200 with an ok status and db check when the healthz secret is not provided (public, non-detailed view)', async () => {
    const res = await healthz(jsonRequest('http://localhost/api/healthz'))
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.status).toBe('ok')
    expect(data.db).toBe('ok')
    // Non-detailed view: no backup/freshness fields leaked without the secret.
    expect(data.backups).toBeUndefined()
    expect(data.freshness_breach).toBeUndefined()
  })

  it('200 with the full detail payload when the correct x-healthz-secret header is provided', async () => {
    const res = await healthz(
      jsonRequest('http://localhost/api/healthz', {
        headers: { 'x-healthz-secret': process.env.HEALTHZ_SECRET! },
      })
    )
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.status).toBe('ok')
    expect(data.db).toBe('ok')
    expect(data.backups).toBeDefined()
    expect(data.freshness_breach).toBe(false)
    expect(data.stale_jobs).toEqual([])
  })

  it('200 with the non-detailed view when the wrong x-healthz-secret header is provided', async () => {
    const res = await healthz(
      jsonRequest('http://localhost/api/healthz', {
        headers: { 'x-healthz-secret': 'wrong-secret' },
      })
    )
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.status).toBe('ok')
    expect(data.backups).toBeUndefined()
  })
})

describe('GET /api/docs', () => {
  it('200 with the OpenAPI spec, no auth required', async () => {
    const res = await docs()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.openapi).toBe('3.0.0')
    expect(body.paths).toBeTruthy()
  })
})

describe('GET /api/internal/webhook-worker/health', () => {
  it('503 disabled response when ENABLE_ASYNC_WEBHOOK_PROCESSING is unset', async () => {
    expect(process.env.ENABLE_ASYNC_WEBHOOK_PROCESSING).not.toBe('true')
    const res = await workerHealth()
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.message).toBe('async webhook processing is disabled')
  })
})
