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

// Same reasoning, applied to every credential the suite needs only in order to
// boot. None of these carries meaning for any assertion — the suite needs *a*
// valid signing key, not a particular one — so leaving them to .env.test made
// the whole run hostage to a value no test names. It duly broke: a local
// .env.test that had truncated JWT_SECRET to "test-jwt-secret" (15 chars) put
// it one character under the 16-char floor lib/config enforces, and every
// integration test failed with a ConfigError from the first signToken call,
// nowhere near the misconfigured file.
//
// Assigned unconditionally, not defaulted-if-unset: a wrong value in an
// operator's environment is precisely the failure being designed out, so
// deferring to it would keep the trap open. TEST_DATABASE_URL above is the
// deliberate exception — it names a machine-specific database, so it is the
// one variable that genuinely belongs to the operator.
process.env.JWT_SECRET = 'integration-test-jwt-secret-at-least-16-chars'
process.env.WEBHOOK_SECRET = 'integration-test-webhook-secret'
// Read back out of the environment by system.integration.test.ts and sent as
// request headers, so the value only has to agree with itself.
process.env.AUTOMATION_SWEEPER_SECRET = 'integration-test-sweeper-secret'
process.env.HEALTHZ_SECRET = 'integration-test-healthz-secret'
// A placeholder on purpose: the suite must never reach the real Resend API.
process.env.AUTH_RESEND_API_KEY = 're_integration_test_placeholder'
process.env.AUTH_EMAIL_FROM = 'test@example.com'
process.env.AUTH_EMAIL_FROM_NAME = 'Integration Test'

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
