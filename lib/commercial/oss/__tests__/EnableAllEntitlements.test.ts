import { describe, it, expect } from 'vitest'
import { EnableAllEntitlements } from '../EnableAllEntitlements'

describe('EnableAllEntitlements (OSS)', () => {
  it('enables email inboxes', async () => {
    const entitlements = new EnableAllEntitlements()
    const result = await entitlements.canUse({
      organizationId: 'org-123',
      feature: 'email_inboxes'
    })
    expect(result).toBe(true)
  })

  it('enables SMS inboxes', async () => {
    const entitlements = new EnableAllEntitlements()
    const result = await entitlements.canUse({
      organizationId: 'org-123',
      feature: 'sms_inboxes'
    })
    expect(result).toBe(true)
  })

  it('enables automations', async () => {
    const entitlements = new EnableAllEntitlements()
    const result = await entitlements.canUse({
      organizationId: 'org-123',
      feature: 'automations'
    })
    expect(result).toBe(true)
  })

  it('enables webhooks', async () => {
    const entitlements = new EnableAllEntitlements()
    const result = await entitlements.canUse({
      organizationId: 'org-123',
      feature: 'webhooks'
    })
    expect(result).toBe(true)
  })

  it('enables any custom feature', async () => {
    const entitlements = new EnableAllEntitlements()
    const result = await entitlements.canUse({
      organizationId: 'org-123',
      feature: 'custom_feature_xyz'
    })
    expect(result).toBe(true)
  })
})
