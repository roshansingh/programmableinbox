import { PrismaClient } from '../lib/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  const passwordHash = await bcrypt.hash('password123', 10)

  const user = await prisma.user.upsert({
    where: { email: 'test@example.com' },
    update: {},
    create: {
      email: 'test@example.com',
      passwordHash,
      firstName: 'Test',
      lastName: 'User',
      emailVerified: true,
    },
  })

  const org = await prisma.organization.upsert({
    where: { slug: 'test-organization' },
    update: {},
    create: {
      name: 'Test Organization',
      slug: 'test-organization',
    },
  })

  await prisma.membership.upsert({
    where: {
      userId_organizationId: {
        userId: user.id,
        organizationId: org.id,
      },
    },
    update: {},
    create: {
      userId: user.id,
      organizationId: org.id,
      role: 'owner',
    },
  })

  // Keyed on `email` rather than a hardcoded id: ids are now generated UUIDv7,
  // so the seed cannot name them up front. `email` is @unique, which is what
  // keeps re-seeding idempotent.
  const emailInbox = await prisma.emailInbox.upsert({
    where: { email: 'inbox@example.com' },
    update: {},
    create: {
      organizationId: org.id,
      userId: user.id,
      email: 'inbox@example.com',
      name: 'Main Inbox',
    },
  })

  // PhoneInbox has no unique column to upsert against (phoneNumber is not
  // @unique — the same number may legitimately recur across orgs), so
  // idempotency is find-then-create scoped to this seed's org.
  const existingPhoneInbox = await prisma.phoneInbox.findFirst({
    where: { organizationId: org.id, phoneNumber: '+1234567890' },
  })

  const phoneInbox =
    existingPhoneInbox ??
    (await prisma.phoneInbox.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        phoneNumber: '+1234567890',
        countryCode: 'US',
      },
    }))

  console.log('Seed data created successfully')
  console.log(`  User: test@example.com / password123`)
  console.log(`  Organization: ${org.name} (${org.slug})`)
  // Ids are generated now, not fixed strings — print them so they can be used
  // directly in manual API calls.
  console.log(`  User id:         ${user.id}`)
  console.log(`  Organization id: ${org.id}`)
  console.log(`  Email inbox id:  ${emailInbox.id}`)
  console.log(`  Phone inbox id:  ${phoneInbox.id}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
