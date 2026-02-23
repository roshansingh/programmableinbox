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

  await prisma.emailInbox.upsert({
    where: { id: 'seed-email-inbox' },
    update: {},
    create: {
      id: 'seed-email-inbox',
      organizationId: org.id,
      userId: user.id,
      email: 'inbox@example.com',
      name: 'Main Inbox',
    },
  })

  await prisma.phoneInbox.upsert({
    where: { id: 'seed-phone-inbox' },
    update: {},
    create: {
      id: 'seed-phone-inbox',
      organizationId: org.id,
      userId: user.id,
      phoneNumber: '+1234567890',
      countryCode: 'US',
    },
  })

  console.log('Seed data created successfully')
  console.log(`  User: test@example.com / password123`)
  console.log(`  Organization: ${org.name} (${org.slug})`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
