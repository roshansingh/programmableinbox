/**
 * Soft-delete enforcement (F8).
 *
 * Soft delete is only as good as its weakest read path: a single query that
 * forgets `deletedAt: null` serves deleted mail back to the API. Rather than
 * repeat that filter across ~49 call sites and hope no future route forgets
 * it, the filter is injected once by a Prisma client extension (see
 * `lib/db.ts`), and this module holds the decision logic so it can be tested
 * without a database.
 *
 * Only *read* operations are filtered. That is sufficient because every write
 * route reads the row first to authorize it, so a soft-deleted row is already
 * unreachable for writes — the read returns nothing and the route 404s.
 *
 * NOT covered: `$queryRaw`. Raw SQL bypasses extensions entirely and must
 * filter by hand (see `grouped-query.ts`).
 */

/** Models carrying a `deletedAt` column. */
export const SOFT_DELETE_MODELS = new Set([
  'EmailInbox',
  'EmailMessage',
  'PhoneInbox',
  'Automation',
  'Webhook',
])

/**
 * Read operations that must never see deleted rows.
 *
 * `findUnique`/`findUniqueOrThrow` are included and rely on Prisma's
 * extended-where-unique support: a non-unique filter is allowed alongside a
 * unique one, so `{ id, deletedAt: null }` is valid and still uses the PK.
 */
export const FILTERED_READ_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
])

export function isSoftDeleteFiltered(model: string | undefined, operation: string): boolean {
  return model !== undefined && SOFT_DELETE_MODELS.has(model) && FILTERED_READ_OPERATIONS.has(operation)
}

export type QueryArgs = { where?: Record<string, unknown> } | undefined

/**
 * Adds `deletedAt: null` to a query's where clause.
 *
 * An explicit `deletedAt` in the caller's where is left untouched. That is the
 * deliberate escape hatch for views that need deleted rows — e.g. showing a
 * user that an inbox was deleted via `where: { deletedAt: { not: null } }`.
 */
export function applySoftDeleteFilter(args: QueryArgs): Record<string, unknown> {
  const next = (args ?? {}) as Record<string, unknown>
  const where = (next.where ?? {}) as Record<string, unknown>

  if ('deletedAt' in where) {
    return next
  }

  return { ...next, where: { ...where, deletedAt: null } }
}
