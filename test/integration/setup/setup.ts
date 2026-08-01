// test/integration/setup/setup.ts
import { beforeEach, afterAll } from 'vitest'
import { parseTestDbUrl } from './db-url'

const raw = process.env.TEST_DATABASE_URL
if (!raw) {
  throw new Error('TEST_DATABASE_URL is required for integration tests. See .env.test.example')
}

const { dbName, appUrl } = parseTestDbUrl(raw)

// SAFETY GUARD: refuse to touch a database that does not look like a test DB.
// Integration tests TRUNCATE every table; pointing them at dev/prod would wipe it.
if (!/test/i.test(dbName)) {
  throw new Error(
    `Refusing to run: database name "${dbName}" does not contain "test". ` +
      `Set TEST_DATABASE_URL to a dedicated test database.`,
  )
}

// Must be set before any test imports @/lib/db (that module reads DATABASE_URL
// at first import and caches the client on globalThis).
process.env.DATABASE_URL = appUrl

// Inbox creation is fail-closed on the domain allowlist (issue #98), so without
// this every create in the suite would stop at a 503 before reaching the
// behavior under test. Set here rather than read from .env.test on purpose: the
// domains the fixtures claim at are a property of the tests, not of whoever
// configured the machine, and a suite whose outcome depends on an operator's
// env value is not reproducible. Tests that exercise the allowlist itself
// override this per-test and restore it afterwards.
process.env.EMAIL_INBOX_DOMAINS = 'test.dev,corp.com,example.com,case.dev'

// Imported AFTER DATABASE_URL is set so the singleton binds to the test DB.
const { prisma } = await import('@/lib/db')

export async function truncateAll(): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `
  if (rows.length === 0) return
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(', ')
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`)
}

beforeEach(async () => {
  await truncateAll()
})

afterAll(async () => {
  await truncateAll()
  await prisma.$disconnect()
})
