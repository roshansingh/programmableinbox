import { describe, expect, it } from 'vitest'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { prisma } from '@/lib/db'
import { createOrgWithUser } from './helpers/auth'

/**
 * The migration has already run against this database by the time the suite
 * starts, and `setup.ts` truncates every table before each test — so asserting
 * "no row holds messages:delete" on its own would pass against an empty table
 * whatever the SQL said. These tests instead seed the cases the migration is
 * meant to handle and re-run the real migration file against them.
 */
const MIGRATION_SQL = path.join(
  process.cwd(),
  'prisma/migrations/20260731135222_retire_messages_delete_scope/migration.sql',
)

/**
 * Executes the migration file statement by statement. Comment lines are
 * stripped first: `$executeRawUnsafe` takes one statement per call, and the
 * file's leading `--` blocks would otherwise ride along with the split.
 */
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

describe('api key scope migration', () => {
  it('strips messages:delete from a key that also holds read scopes', async () => {
    const { org, user } = await createOrgWithUser()
    const id = await seedKey(org.id, user.id, ['inboxes:read', 'messages:read', 'messages:delete'])

    await applyMigration()

    expect(await scopesOf(id)).toEqual(['inboxes:read', 'messages:read'])
  })

  it('backfills a key holding only messages:delete rather than emptying it', async () => {
    const { org, user } = await createOrgWithUser()
    const id = await seedKey(org.id, user.id, ['messages:delete'])

    await applyMigration()

    // Not [] — an empty scope list authenticates but authorizes nothing, which
    // surfaces as a 403 on every request and reads like a misconfiguration.
    expect(await scopesOf(id)).toEqual(['inboxes:read', 'messages:read'])
  })

  it('backfills an active key that was already empty', async () => {
    const { org, user } = await createOrgWithUser()
    const id = await seedKey(org.id, user.id, [])

    await applyMigration()

    expect(await scopesOf(id)).toEqual(['inboxes:read', 'messages:read'])
  })

  it('backfills an active key whose scopes are NULL', async () => {
    // `scopes` is nullable in the database (TEXT[] with a default, no NOT NULL),
    // so a row written outside Prisma can hold NULL. cardinality(NULL) = 0 is
    // NULL rather than true, so the safety net has to coalesce to catch it.
    const { org, user } = await createOrgWithUser()
    const id = await seedKey(org.id, user.id, [])
    await prisma.$executeRawUnsafe('UPDATE "api_keys" SET "scopes" = NULL WHERE "id" = $1::uuid', id)

    await applyMigration()

    expect(await scopesOf(id)).toEqual(['inboxes:read', 'messages:read'])
  })

  it('leaves a revoked empty key untouched', async () => {
    const { org, user } = await createOrgWithUser()
    const id = await seedKey(org.id, user.id, [], { revoked: true })

    await applyMigration()

    expect(await scopesOf(id)).toEqual([])
  })

  it('leaves a key without the retired scope unchanged', async () => {
    const { org, user } = await createOrgWithUser()
    const id = await seedKey(org.id, user.id, ['inboxes:read'])

    await applyMigration()

    expect(await scopesOf(id)).toEqual(['inboxes:read'])
  })

  it('is idempotent', async () => {
    const { org, user } = await createOrgWithUser()
    const id = await seedKey(org.id, user.id, ['messages:read', 'messages:delete'])

    await applyMigration()
    const afterFirst = await scopesOf(id)
    await applyMigration()

    expect(await scopesOf(id)).toEqual(afterFirst)
    expect(afterFirst).toEqual(['messages:read'])
  })

  it('leaves no key holding messages:delete', async () => {
    const stale = await prisma.apiKey.findMany({
      where: { scopes: { has: 'messages:delete' } },
      select: { id: true },
    })
    expect(stale).toEqual([])
  })

  it('leaves no active key with an empty scope list', async () => {
    const empty = await prisma.apiKey.findMany({
      where: { scopes: { isEmpty: true }, revokedAt: null },
      select: { id: true },
    })
    expect(empty).toEqual([])
  })
})
