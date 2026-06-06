import { describe, it, expect } from 'vitest'
import { AllowAllPolicy } from '../AllowAllPolicy'

describe('AllowAllPolicy (OSS)', () => {
  it('allows all API key creation', async () => {
    const policy = new AllowAllPolicy()
    const result = await policy.check({
      organizationId: 'org-123',
      action: 'apiKey.create'
    })
    expect(result.allowed).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it('allows email processing', async () => {
    const policy = new AllowAllPolicy()
    const result = await policy.check({
      organizationId: 'org-123',
      action: 'email.process',
      quantity: 1000
    })
    expect(result.allowed).toBe(true)
  })

  it('allows SMS processing', async () => {
    const policy = new AllowAllPolicy()
    const result = await policy.check({
      organizationId: 'org-123',
      action: 'sms.process',
      quantity: 500
    })
    expect(result.allowed).toBe(true)
  })

  it('allows inbox creation', async () => {
    const policy = new AllowAllPolicy()
    const result = await policy.check({
      organizationId: 'org-123',
      action: 'emailInbox.create'
    })
    expect(result.allowed).toBe(true)
  })

  it('allows phone inbox creation', async () => {
    const policy = new AllowAllPolicy()
    const result = await policy.check({
      organizationId: 'org-123',
      action: 'phoneInbox.create'
    })
    expect(result.allowed).toBe(true)
  })
})
