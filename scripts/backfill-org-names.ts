/**
 * Renames organizations still carrying the legacy placeholder name
 * ("My Organization") to their owner's name, matching what registration now
 * assigns by default.
 *
 * Only touches orgs with exactly one owner whose name is resolvable — orgs that
 * were deliberately renamed, are ownerless, or are co-owned are left alone.
 *
 *   npm run backfill:org-names -- --dry-run
 *   npm run backfill:org-names
 */
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { defaultOrganizationName } from '@/lib/user-display'

const LEGACY_NAME = 'My Organization'
const dryRun = process.argv.includes('--dry-run')

async function main() {
  const orgs = await prisma.organization.findMany({
    where: { name: LEGACY_NAME },
    include: {
      memberships: {
        where: { role: 'owner' },
        include: { user: true },
      },
    },
  })

  let updated = 0
  let skipped = 0

  for (const org of orgs) {
    if (org.memberships.length !== 1) {
      console.log(`Skipping ${org.id}: expected exactly 1 owner, found ${org.memberships.length}.`)
      skipped += 1
      continue
    }

    const owner = org.memberships[0].user
    const nextName = defaultOrganizationName(owner.firstName, owner.lastName, owner.email)

    if (nextName === LEGACY_NAME) {
      console.log(`Skipping ${org.id}: owner ${owner.email} has no usable name.`)
      skipped += 1
      continue
    }

    if (dryRun) {
      console.log(`Would rename ${org.id} "${LEGACY_NAME}" -> "${nextName}" (owner ${owner.email}).`)
      updated += 1
      continue
    }

    await prisma.organization.update({
      where: { id: org.id },
      data: { name: nextName },
    })

    console.log(`Renamed ${org.id} "${LEGACY_NAME}" -> "${nextName}" (owner ${owner.email}).`)
    updated += 1
  }

  console.log(
    `Backfill complete${dryRun ? ' (dry run)' : ''}. Renamed ${updated} organizations; skipped ${skipped}.`
  )
}

main()
  .catch((error) => {
    console.error('Failed to backfill organization names.', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
