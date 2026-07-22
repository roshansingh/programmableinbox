// test/integration/helpers/auth.ts
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { signToken, hashPassword } from '@/lib/auth-server'

let counter = 0
function uniq(prefix: string) {
  counter += 1
  return `${prefix}-${counter}`
}

export async function createOrgWithUser(
  opts: { email?: string; role?: string; orgName?: string } = {},
) {
  const email = opts.email ?? `${uniq('user')}@test.dev`
  const user = await prisma.user.create({
    data: { email, passwordHash: await hashPassword('password123'), emailVerified: true },
  })
  const org = await prisma.organization.create({
    data: { name: opts.orgName ?? 'Test Org', slug: uniq('org') },
  })
  const membership = await prisma.membership.create({
    data: { userId: user.id, organizationId: org.id, role: (opts.role ?? 'owner') as never },
  })
  return { user, org, membership, token: signToken({ userId: user.id }) }
}

export async function createSecondOrg() {
  return createOrgWithUser({ orgName: 'Other Org' })
}

export async function createApiKey(orgId: string, userId: string, scopes: string[]) {
  const rawKey = `sk_live_${crypto.randomBytes(24).toString('hex')}`
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex')
  const key = await prisma.apiKey.create({
    data: {
      apiKey: null,
      keyHash,
      prefix: rawKey.slice(0, 12),
      name: 'test key',
      scopes,
      organizationId: orgId,
      userId,
    },
  })
  return { id: key.id, rawKey }
}
