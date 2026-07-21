// test/integration/helpers.integration.test.ts
import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/db'
import { createOrgWithUser, createApiKey } from './helpers/auth'
import { seedInbox, seedMessage } from './helpers/factories'
import { verifyToken } from '@/lib/auth-server'

describe('integration helpers', () => {
  it('creates a real org, user, membership and a valid JWT', async () => {
    const { user, org, token } = await createOrgWithUser()
    expect(await prisma.membership.count({ where: { userId: user.id, organizationId: org.id } })).toBe(1)
    expect(verifyToken(token)?.userId).toBe(user.id)
  })

  it('creates an API key that resolves via the real hash lookup', async () => {
    const { org, user } = await createOrgWithUser()
    const { rawKey } = await createApiKey(org.id, user.id, ['messages:read'])
    const { resolveApiKeyPrincipal } = await import('@/lib/auth/api-key-auth')
    const principal = await resolveApiKeyPrincipal(rawKey)
    expect(principal?.organizationId).toBe(org.id)
    expect(principal?.scopes).toEqual(['messages:read'])
  })

  it('seeds inbox + message with a valid uuid threadId', async () => {
    const { org, user } = await createOrgWithUser()
    const inbox = await seedInbox(org.id, user.id)
    const msg = await seedMessage(inbox.id, org.id)
    expect(msg.inboxEmailAddressId).toBe(inbox.id)
  })
})
