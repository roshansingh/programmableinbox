import { describe, expect, it } from 'vitest'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { prisma } from '@/lib/db'
import { createOrgWithUser } from './helpers/auth'

/**
 * The migration has already run against this database by the time the suite
 * starts, and `setup.ts` truncates every table before each test — so asserting
 * "no row holds inboxes:read" on its own would pass against an empty table
 * whatever the SQL said. These tests instead seed the cases the migration is
 * meant to handle and re-run the real migration file against them.
 *
 * Same shape as `api-key-scope-migration.integration.test.ts`, which covers the
 * earlier `messages:delete` retirement.
 */
const MIGRATION_SQL = path.join(
  process.cwd(),
  'prisma/migrations/20260805120000_prefix_email_scopes/migration.sql',
)

async function applyMigration(): Promise<void> {
  const sql = fs.readFileSync(MIGRATION_SQL, 'utf8')
  const statements = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)

  expect(statements).toHaveLength(3)

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement)
  }
}

async function seedKey(
  orgId: string,
  userId: string,
  scopes: string[],
  opts: { revoked?: boolean } = {},
): Promise<string> {
  const raw = `sk_live_${crypto.randomBytes(24).toString('hex')}`
  const key = await prisma.apiKey.create({
    data: {
      apiKey: null,
      keyHash: crypto.createHash('sha256').update(raw).digest('hex'),
      prefix: raw.slice(0, 12),
      name: 'migration fixture',
      scopes,
      organizationId: orgId,
      userId,
      revokedAt: opts.revoked ? new Date() : null,
    },
  })
  return key.id
}

async function scopesOf(id: string): Promise<string[]> {
  const row = await prisma.apiKey.findUniqueOrThrow({ where: { id }, select: { scopes: true } })
  return row.scopes
}

describe('api key scope prefix migration', () => {
  it('renames both read scopes on a key holding them', async () => {
    const { org, user } = await createOrgWithUser()
    const id = await seedKey(org.id, user.id, ['inboxes:read', 'messages:read'])

    await applyMigration()

    expect(await scopesOf(id)).toEqual(['email_inboxes:read', 'email_messages:read'])
  })

  it('preserves order, so a key holding both keeps both', async () => {
    const { org, user } = await createOrgWithUser()
    const id = await seedKey(org.id, user.id, ['messages:read', 'inboxes:read'])

    await applyMigration()

    expect(await scopesOf(id)).toEqual(['email_messages:read', 'email_inboxes:read'])
  })

  it('renames a key holding only one of them', async () => {
    const { org, user } = await createOrgWithUser()
    const id = await seedKey(org.id, user.id, ['inboxes:read'])

    await applyMigration()

    expect(await scopesOf(id)).toEqual(['email_inboxes:read'])
  })

  it('grants no write scope to anyone', async () => {
    // A rename must never be a privilege grant. The mutating scopes may only
    // ever be held by a key whose creator chose them.
    const { org, user } = await createOrgWithUser()
    const id = await seedKey(org.id, user.id, ['inboxes:read', 'messages:read'])

    await applyMigration()

    const scopes = await scopesOf(id)
    for (const granted of scopes) {
      expect(granted.endsWith(':read')).toBe(true)
    }
  })

  it('backfills an active key that was already empty, with read scopes only', async () => {
    const { org, user } = await createOrgWithUser()
    const id = await seedKey(org.id, user.id, [])

    await applyMigration()

    expect(await scopesOf(id)).toEqual(['email_inboxes:read', 'email_messages:read'])
  })

  it('backfills an active key whose scopes are NULL', async () => {
    // `scopes` is nullable in the database, so a row written outside Prisma can
    // hold NULL. cardinality(NULL) = 0 is NULL rather than true, so the safety
    // net has to coalesce to catch it.
    const { org, user } = await createOrgWithUser()
    const id = await seedKey(org.id, user.id, [])
    await prisma.$executeRawUnsafe('UPDATE "api_keys" SET "scopes" = NULL WHERE "id" = $1::uuid', id)

    await applyMigration()

    expect(await scopesOf(id)).toEqual(['email_inboxes:read', 'email_messages:read'])
  })

  it('leaves a revoked empty key untouched', async () => {
    const { org, user } = await createOrgWithUser()
    const id = await seedKey(org.id, user.id, [], { revoked: true })

    await applyMigration()

    expect(await scopesOf(id)).toEqual([])
  })

  it('leaves an already-migrated key unchanged', async () => {
    const { org, user } = await createOrgWithUser()
    const id = await seedKey(org.id, user.id, ['email_inboxes:read', 'email_inboxes:delete'])

    await applyMigration()

    expect(await scopesOf(id)).toEqual(['email_inboxes:read', 'email_inboxes:delete'])
  })

  it('is idempotent', async () => {
    const { org, user } = await createOrgWithUser()
    const id = await seedKey(org.id, user.id, ['inboxes:read', 'messages:read'])

    await applyMigration()
    const afterFirst = await scopesOf(id)
    await applyMigration()

    expect(await scopesOf(id)).toEqual(afterFirst)
    expect(afterFirst).toEqual(['email_inboxes:read', 'email_messages:read'])
  })
})
