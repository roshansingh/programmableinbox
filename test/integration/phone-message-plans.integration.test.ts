import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PlanLimitsSchema } from '@/lib/commercial/plan-limits'
import { prisma } from '@/lib/db'

/** Same approach as phone-inbox-plans: run the migration's own SQL against restored rows. */
const MIGRATION = path.join(
  process.cwd(),
  'prisma/migrations/20261105090100_sms_received_quota_pro/migration.sql',
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
      limits: {
        emailInboxes: 2,
        phoneInboxesEnabled: true,
        phoneInboxes: 1,
        overQuotaBehavior: 'overage',
      },
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

describe('capping received SMS on the paid plan', () => {
  it('gives Pro 500 received messages a period, leaving its other limits alone', async () => {
    await seedPreviousPlans()

    await prisma.$executeRawUnsafe(readFileSync(MIGRATION, 'utf8'))

    expect(await limitsOf('pro')).toMatchObject({
      incomingSmsPerPeriod: 500,
      phoneInboxes: 1,
      emailInboxes: 2,
      overQuotaBehavior: 'overage',
    })
  })

  it('leaves Free and the unlimited self-hosted plan uncapped', async () => {
    await seedPreviousPlans()

    await prisma.$executeRawUnsafe(readFileSync(MIGRATION, 'utf8'))

    expect((await limitsOf('free')).incomingSmsPerPeriod).toBeNull()
    expect((await limitsOf('self_hosted')).incomingSmsPerPeriod).toBeNull()
  })

  it('is safe to run on a database with no plan rows', async () => {
    await expect(prisma.$executeRawUnsafe(readFileSync(MIGRATION, 'utf8'))).resolves.toBeDefined()
  })
})
