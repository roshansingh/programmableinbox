import { describe, expect, it } from 'vitest'

describe('POST /api/v1/webhooks/email (compatibility alias)', () => {
  it('re-exports the same handler as /api/webhooks/email', async () => {
    const alias = await import('../route')
    const canonical = await import('@/app/api/webhooks/email/route')

    expect(alias.POST).toBe(canonical.POST)
  })
})
