import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PlanLimitsSchema } from '@/lib/commercial/plan-limits'
import { prisma } from '@/lib/db'

/**
 * The integration setup truncates `plans` before every test, so the seed rows
 * the real migrations insert are gone by the time a test runs. This runs the
 * enabling migration's own SQL against rows restored to their previous state,
 * which is what tests the statement rather than a copy of its intent.
 */
const MIGRATION = path.join(
  process.cwd(),
  'prisma/migrations/20261104130000_enable_phone_inboxes_pro/migration.sql',
)

async function seedPreviousPlans() {
  await prisma.plan.create({
    data: {
      code: 'free',
      name: 'Free',
      isPublic: true,
      limits: { emailInboxes: 1, phoneInboxesEnabled: false, overQuotaBehavior: 'drop' },
    },
  })
  await prisma.plan.create({
    data: {
      code: 'pro',
      name: 'Pro',
      isPublic: true,
      limits: { emailInboxes: 2, phoneInboxesEnabled: false, overQuotaBehavior: 'overage' },
    },
  })
  await prisma.plan.create({
    data: { code: 'self_hosted', name: 'Self-hosted', isPublic: false, limits: {} },
  })
}

async function limitsOf(code: string) {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code } })
  return PlanLimitsSchema.parse(plan.limits)
}

describe('enabling phone inboxes on the paid plan', () => {
  it('turns phone inboxes on for Pro with a limit of two, leaving its other limits alone', async () => {
    await seedPreviousPlans()

    await prisma.$executeRawUnsafe(readFileSync(MIGRATION, 'utf8'))

    expect(await limitsOf('pro')).toMatchObject({
      phoneInboxesEnabled: true,
      phoneInboxes: 2,
      emailInboxes: 2,
      overQuotaBehavior: 'overage',
    })
  })

  it('leaves Free without phone inboxes', async () => {
    await seedPreviousPlans()

    await prisma.$executeRawUnsafe(readFileSync(MIGRATION, 'utf8'))

    expect((await limitsOf('free')).phoneInboxesEnabled).toBe(false)
  })

  it('does not touch the self-hosted plan, which stays unlimited', async () => {
    await seedPreviousPlans()

    await prisma.$executeRawUnsafe(readFileSync(MIGRATION, 'utf8'))

    const limits = await limitsOf('self_hosted')
    expect(limits.phoneInboxesEnabled).toBe(true)
    expect(limits.phoneInboxes).toBeNull()
  })

  it('is safe to run on a database with no plan rows', async () => {
    await expect(prisma.$executeRawUnsafe(readFileSync(MIGRATION, 'utf8'))).resolves.toBeDefined()
  })
})
