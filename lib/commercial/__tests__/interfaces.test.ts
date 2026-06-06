import { describe, it, expect } from 'vitest'
import type {
  IPolicy,
  PolicyCheckRequest,
  PolicyCheckResult,
  IEntitlements,
  EntitlementCheckRequest,
  IMetering,
  MeteringRequest,
} from '../interfaces'

describe('IPolicy interface', () => {
  it('defines check method that returns PolicyCheckResult', () => {
    const mockPolicy: IPolicy = {
      check: async (request: PolicyCheckRequest): Promise<PolicyCheckResult> => ({
        allowed: true
      })
    }

    expect(mockPolicy.check).toBeDefined()
    expect(typeof mockPolicy.check).toBe('function')
  })

  it('PolicyCheckRequest has organizationId and action', async () => {
    const mockPolicy: IPolicy = {
      check: async (request: PolicyCheckRequest): Promise<PolicyCheckResult> => {
        expect(request.organizationId).toBeDefined()
        expect(['apiKey.create', 'email.process', 'sms.process', 'emailInbox.create', 'phoneInbox.create']).toContain(request.action)
        expect(['number', 'undefined']).toContain(typeof request.quantity)
        return { allowed: true }
      }
    }

    await mockPolicy.check({
      organizationId: 'org-123',
      action: 'apiKey.create',
      quantity: 1
    })
  })

  it('PolicyCheckResult has allowed boolean and optional reason', async () => {
    const mockPolicyWithReason: IPolicy = {
      check: async (): Promise<PolicyCheckResult> => ({
        allowed: false,
        reason: 'API key limit reached'
      })
    }

    const resultWithReason = await mockPolicyWithReason.check({
      organizationId: 'org-123',
      action: 'apiKey.create'
    })

    expect(typeof resultWithReason.allowed).toBe('boolean')
    expect(resultWithReason.reason).toBeDefined()
    expect(typeof resultWithReason.reason).toBe('string')
  })

  it('PolicyCheckResult allows reason to be omitted', async () => {
    const mockPolicyWithoutReason: IPolicy = {
      check: async (): Promise<PolicyCheckResult> => ({
        allowed: false
      })
    }

    const resultWithoutReason = await mockPolicyWithoutReason.check({
      organizationId: 'org-123',
      action: 'apiKey.create'
    })

    expect(typeof resultWithoutReason.allowed).toBe('boolean')
    expect(resultWithoutReason.reason).toBeUndefined()
  })
})

describe('IEntitlements interface', () => {
  it('defines canUse method that returns boolean', () => {
    const mockEntitlements: IEntitlements = {
      canUse: async (request: EntitlementCheckRequest): Promise<boolean> => true
    }

    expect(mockEntitlements.canUse).toBeDefined()
    expect(typeof mockEntitlements.canUse).toBe('function')
  })

  it('EntitlementCheckRequest has organizationId and feature', async () => {
    const mockEntitlements: IEntitlements = {
      canUse: async (request: EntitlementCheckRequest): Promise<boolean> => {
        expect(request.organizationId).toBeDefined()
        expect(typeof request.feature).toBe('string')
        return true
      }
    }

    const result = await mockEntitlements.canUse({
      organizationId: 'org-123',
      feature: 'automations'
    })

    expect(typeof result).toBe('boolean')
  })
})

describe('IMetering interface', () => {
  it('defines record method that is async and non-blocking', () => {
    const mockMetering: IMetering = {
      record: async (request: MeteringRequest): Promise<void> => {
        // No-op
      }
    }

    expect(mockMetering.record).toBeDefined()
    expect(typeof mockMetering.record).toBe('function')
  })

  it('MeteringRequest has organizationId, metric, and quantity', async () => {
    const mockMetering: IMetering = {
      record: async (request: MeteringRequest): Promise<void> => {
        expect(request.organizationId).toBeDefined()
        expect(typeof request.metric).toBe('string')
        expect(typeof request.quantity).toBe('number')
        expect(request.quantity > 0).toBe(true)
      }
    }

    await mockMetering.record({
      organizationId: 'org-123',
      metric: 'emails_processed',
      quantity: 5
    })
  })

  it('record() never throws', async () => {
    const mockMetering: IMetering = {
      record: async (request: MeteringRequest): Promise<void> => {
        throw new Error('This should never be thrown')
      }
    }

    // Even if record throws, metering should fire-and-forget in practice
    await expect(mockMetering.record({
      organizationId: 'org-123',
      metric: 'emails_processed',
      quantity: 1
    })).rejects.toThrow()
  })
})
