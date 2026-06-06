import { describe, it, expect, afterEach, vi } from 'vitest'
import { CommercialProvider } from '../provider'
import { AllowAllPolicy } from '../oss/AllowAllPolicy'
import { EnableAllEntitlements } from '../oss/EnableAllEntitlements'
import { NoopMetering } from '../oss/NoopMetering'

describe('CommercialProvider', () => {
  afterEach(() => {
    // Reset to uninitialized state, forcing lazy-load of defaults on next access
    CommercialProvider.reset()
  })

  describe('lazy-loading defaults', () => {
    it('provides AllowAllPolicy on first policy access', () => {
      const policy = CommercialProvider.policy
      expect(policy).toBeInstanceOf(AllowAllPolicy)
    })

    it('provides EnableAllEntitlements on first entitlements access', () => {
      const entitlements = CommercialProvider.entitlements
      expect(entitlements).toBeInstanceOf(EnableAllEntitlements)
    })

    it('provides NoopMetering on first metering access', () => {
      const metering = CommercialProvider.metering
      expect(metering).toBeInstanceOf(NoopMetering)
    })

    it('returns same instance on repeated access', () => {
      const policy1 = CommercialProvider.policy
      const policy2 = CommercialProvider.policy
      expect(policy1).toBe(policy2)
    })
  })

  describe('configure()', () => {
    it('allows setting custom policy', () => {
      const mockPolicy = { check: async () => ({ allowed: false }) }
      CommercialProvider.configure(mockPolicy, CommercialProvider.entitlements, CommercialProvider.metering)
      expect(CommercialProvider.policy).toBe(mockPolicy)
    })

    it('allows setting custom entitlements', () => {
      const mockEntitlements = { canUse: async () => false }
      CommercialProvider.configure(CommercialProvider.policy, mockEntitlements, CommercialProvider.metering)
      expect(CommercialProvider.entitlements).toBe(mockEntitlements)
    })

    it('allows setting custom metering', () => {
      const mockMetering = { record: async () => {} }
      CommercialProvider.configure(CommercialProvider.policy, CommercialProvider.entitlements, mockMetering)
      expect(CommercialProvider.metering).toBe(mockMetering)
    })

    it('policy check returns rejection when configured to reject', async () => {
      const mockPolicy = {
        check: async () => ({ allowed: false, reason: 'Limit reached' })
      }
      CommercialProvider.configure(mockPolicy, CommercialProvider.entitlements, CommercialProvider.metering)

      const result = await CommercialProvider.policy.check({
        organizationId: 'org-123',
        action: 'apiKey.create'
      })

      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('Limit reached')
    })

    it('entitlements returns false when configured to deny', async () => {
      const mockEntitlements = {
        canUse: async () => false
      }
      CommercialProvider.configure(CommercialProvider.policy, mockEntitlements, CommercialProvider.metering)

      const result = await CommercialProvider.entitlements.canUse({
        organizationId: 'org-123',
        feature: 'automations'
      })

      expect(result).toBe(false)
    })

    it('metering records when configured to track', async () => {
      const recordSpy = vi.fn().mockResolvedValue(undefined)
      const mockMetering = { record: recordSpy }
      CommercialProvider.configure(CommercialProvider.policy, CommercialProvider.entitlements, mockMetering)

      await CommercialProvider.metering.record({
        organizationId: 'org-123',
        metric: 'emails_processed',
        quantity: 5
      })

      expect(recordSpy).toHaveBeenCalledWith({
        organizationId: 'org-123',
        metric: 'emails_processed',
        quantity: 5
      })
    })
  })
})
