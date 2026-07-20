import { describe, expect, it, vi } from 'vitest'
import { claimAutoReplySlot, releaseAutoReplySlot } from '../auto-reply-throttle'

const KEY = { automationId: 'a1', inboxId: 'i1', fromEmail: 'sender@example.com' }
const CUTOFF = new Date('2026-07-18T00:00:00.000Z')
const CLAIM_AT = new Date('2026-07-19T00:00:00.000Z')

function uniqueViolation() {
  return Object.assign(new Error('Unique constraint failed'), {
    code: 'P2002',
    meta: { target: ['automationId', 'inboxId', 'fromEmail'] },
  })
}

function mockClient(overrides: Record<string, unknown> = {}) {
  return {
    autoReplyLedger: {
      updateMany: vi.fn(),
      create: vi.fn(),
      ...overrides,
    },
  } as never
}

describe('claimAutoReplySlot', () => {
  it('wins by claiming an existing eligible row (updateMany count > 0)', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const create = vi.fn()
    const client = mockClient({ updateMany, create })

    const won = await claimAutoReplySlot(KEY, CUTOFF, CLAIM_AT, client)

    expect(won).toBe(true)
    // Conditional update: only claims rows past the window.
    expect(updateMany).toHaveBeenCalledWith({
      where: { ...KEY, lastSentAt: { lt: CUTOFF } },
      data: { lastSentAt: CLAIM_AT },
    })
    // No row existed to update? Then it would create — but here it claimed, so no create.
    expect(create).not.toHaveBeenCalled()
  })

  it('wins by creating the row when none exists (updateMany count 0, create succeeds)', async () => {
    const client = mockClient({
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({ id: 'led_1' }),
    })

    const won = await claimAutoReplySlot(KEY, CUTOFF, CLAIM_AT, client)

    expect(won).toBe(true)
  })

  it('loses (throttled) when the row exists and is recent — create hits P2002', async () => {
    // updateMany matched nothing (lastSentAt within window), and the row already
    // exists so create races and loses with a unique violation.
    const client = mockClient({
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockRejectedValue(uniqueViolation()),
    })

    const won = await claimAutoReplySlot(KEY, CUTOFF, CLAIM_AT, client)

    expect(won).toBe(false)
  })

  it('rethrows a non-unique error from create', async () => {
    const client = mockClient({
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockRejectedValue(new Error('connection reset')),
    })

    await expect(claimAutoReplySlot(KEY, CUTOFF, CLAIM_AT, client)).rejects.toThrow('connection reset')
  })
})

describe('releaseAutoReplySlot', () => {
  it('resets lastSentAt to epoch, guarded on the exact claim timestamp', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const client = mockClient({ updateMany })

    await releaseAutoReplySlot(KEY, CLAIM_AT, client)

    expect(updateMany).toHaveBeenCalledWith({
      where: { ...KEY, lastSentAt: CLAIM_AT },
      data: { lastSentAt: new Date(0) },
    })
  })
})
