import { describe, it, expect } from 'vitest'
import { GET as listEvents } from '@/app/api/app/webhooks/[id]/events/route'
import { POST as retryEvent } from '@/app/api/app/webhooks/[id]/events/[eventId]/retry/route'
import { POST as testWebhook } from '@/app/api/app/webhooks/[id]/test/route'
import { prisma } from '@/lib/db'
import { createOrgWithUser, createSecondOrg } from './helpers/auth'
import { seedWebhook } from './helpers/factories'
import { jsonRequest, params } from './helpers/request'

// NOTE: no stubbing is needed here. `retry` and `test` (read below) only ever
// touch Prisma — there is no outbound `fetch` to the webhook URL and no
// queue/Redis enqueue in either handler, so there is no external boundary to
// stub for these integration tests.

describe('GET /api/app/webhooks/[id]/events', () => {
  it('401 without a token', async () => {
    const res = await listEvents(
      jsonRequest('http://localhost/api/app/webhooks/some-id/events'),
      params({ id: 'some-id' })
    )
    expect(res.status).toBe(401)
  })

  it('404 listing events for another org\'s webhook', async () => {
    const { token } = await createOrgWithUser()
    const other = await createSecondOrg()
    const otherWebhook = await seedWebhook(other.org.id)

    const res = await listEvents(
      jsonRequest(`http://localhost/api/app/webhooks/${otherWebhook.id}/events`, { credential: token }),
      params({ id: otherWebhook.id })
    )
    expect(res.status).toBe(404)
  })

  it('lists events scoped to the webhook, excluding another webhook\'s events', async () => {
    const { org, token } = await createOrgWithUser()
    const webhook = await seedWebhook(org.id)
    const otherWebhook = await seedWebhook(org.id)

    const event1 = await prisma.webhookEvent.create({
      data: { webhookId: webhook.id, event: 'email.received', payload: { foo: 'bar' } },
    })
    const event2 = await prisma.webhookEvent.create({
      data: { webhookId: webhook.id, event: 'email.received', payload: { foo: 'baz' } },
    })
    await prisma.webhookEvent.create({
      data: { webhookId: otherWebhook.id, event: 'email.received', payload: { foo: 'nope' } },
    })

    const res = await listEvents(
      jsonRequest(`http://localhost/api/app/webhooks/${webhook.id}/events`, { credential: token }),
      params({ id: webhook.id })
    )
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.total).toBe(2)
    expect(data.events).toHaveLength(2)
    const ids = data.events.map((e: { id: string }) => e.id)
    expect(ids.sort()).toEqual([event1.id, event2.id].sort())
  })
})

describe('POST /api/app/webhooks/[id]/events/[eventId]/retry', () => {
  it('401 without a token', async () => {
    const res = await retryEvent(
      jsonRequest('http://localhost/api/app/webhooks/some-id/events/some-event/retry', { method: 'POST' }),
      params({ id: 'some-id', eventId: 'some-event' })
    )
    expect(res.status).toBe(401)
  })

  it('404 retrying an event on another org\'s webhook', async () => {
    const { token } = await createOrgWithUser()
    const other = await createSecondOrg()
    const otherWebhook = await seedWebhook(other.org.id)
    const event = await prisma.webhookEvent.create({
      data: { webhookId: otherWebhook.id, event: 'email.received', payload: {}, status: 'failed' },
    })

    const res = await retryEvent(
      jsonRequest(`http://localhost/api/app/webhooks/${otherWebhook.id}/events/${event.id}/retry`, { method: 'POST', credential: token }),
      params({ id: otherWebhook.id, eventId: event.id })
    )
    expect(res.status).toBe(404)

    const row = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: event.id } })
    expect(row.status).toBe('failed')
  })

  it('404 retrying an event that belongs to a different webhook than the one in the URL', async () => {
    const { org, token } = await createOrgWithUser()
    const webhook = await seedWebhook(org.id)
    const otherOwnWebhook = await seedWebhook(org.id)
    const event = await prisma.webhookEvent.create({
      data: { webhookId: otherOwnWebhook.id, event: 'email.received', payload: {}, status: 'failed' },
    })

    const res = await retryEvent(
      jsonRequest(`http://localhost/api/app/webhooks/${webhook.id}/events/${event.id}/retry`, { method: 'POST', credential: token }),
      params({ id: webhook.id, eventId: event.id })
    )
    expect(res.status).toBe(404)
  })

  it('resets a failed event to pending and increments attempts', async () => {
    const { org, token } = await createOrgWithUser()
    const webhook = await seedWebhook(org.id)
    const event = await prisma.webhookEvent.create({
      data: { webhookId: webhook.id, event: 'email.received', payload: {}, status: 'failed', attempts: 1 },
    })

    const res = await retryEvent(
      jsonRequest(`http://localhost/api/app/webhooks/${webhook.id}/events/${event.id}/retry`, { method: 'POST', credential: token }),
      params({ id: webhook.id, eventId: event.id })
    )
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.status).toBe('pending')
    expect(data.attempts).toBe(2)

    const row = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: event.id } })
    expect(row.status).toBe('pending')
    expect(row.attempts).toBe(2)
  })
})

describe('POST /api/app/webhooks/[id]/test', () => {
  it('401 without a token', async () => {
    const res = await testWebhook(
      jsonRequest('http://localhost/api/app/webhooks/some-id/test', { method: 'POST' }),
      params({ id: 'some-id' })
    )
    expect(res.status).toBe(401)
  })

  it('404 testing another org\'s webhook, and does not touch it', async () => {
    const { token } = await createOrgWithUser()
    const other = await createSecondOrg()
    const otherWebhook = await seedWebhook(other.org.id)

    const res = await testWebhook(
      jsonRequest(`http://localhost/api/app/webhooks/${otherWebhook.id}/test`, { method: 'POST', credential: token }),
      params({ id: otherWebhook.id })
    )
    expect(res.status).toBe(404)

    const row = await prisma.webhook.findUniqueOrThrow({ where: { id: otherWebhook.id } })
    expect(row.lastTriggered).toBeNull()
  })

  it('fires a test delivery: creates a pending WebhookEvent and stamps lastTriggered', async () => {
    const { org, token } = await createOrgWithUser()
    const webhook = await seedWebhook(org.id)
    expect(webhook.lastTriggered).toBeNull()

    const res = await testWebhook(
      jsonRequest(`http://localhost/api/app/webhooks/${webhook.id}/test`, { method: 'POST', credential: token }),
      params({ id: webhook.id })
    )
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.webhookId).toBe(webhook.id)
    expect(data.event).toBe('test')
    expect(data.status).toBe('pending')
    expect(data.payload).toMatchObject({ type: 'test' })

    const row = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: data.id } })
    expect(row.webhookId).toBe(webhook.id)
    expect(row.status).toBe('pending')

    const webhookRow = await prisma.webhook.findUniqueOrThrow({ where: { id: webhook.id } })
    expect(webhookRow.lastTriggered).not.toBeNull()
  })
})
