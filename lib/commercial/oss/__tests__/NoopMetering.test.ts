import { describe, it, expect } from 'vitest'
import { NoopMetering } from '../NoopMetering'

describe('NoopMetering (OSS)', () => {
  it('records email metrics without throwing', async () => {
    const metering = new NoopMetering()
    await expect(
      metering.record({
        organizationId: 'org-123',
        metric: 'emails_processed',
        quantity: 100
      })
    ).resolves.toBeUndefined()
  })

  it('records SMS metrics without throwing', async () => {
    const metering = new NoopMetering()
    await expect(
      metering.record({
        organizationId: 'org-123',
        metric: 'sms_processed',
        quantity: 50
      })
    ).resolves.toBeUndefined()
  })

  it('records API call metrics without throwing', async () => {
    const metering = new NoopMetering()
    await expect(
      metering.record({
        organizationId: 'org-123',
        metric: 'api_calls',
        quantity: 1000
      })
    ).resolves.toBeUndefined()
  })

  it('handles large quantities', async () => {
    const metering = new NoopMetering()
    await expect(
      metering.record({
        organizationId: 'org-123',
        metric: 'emails_processed',
        quantity: 1000000
      })
    ).resolves.toBeUndefined()
  })
})
