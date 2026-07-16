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

/** Same-model combinators. Their operands are where-inputs on the same model. */
const LOGICAL_OPERATORS = ['AND', 'OR', 'NOT'] as const

/**
 * True when the caller's where already constrains THIS model's `deletedAt` —
 * at the top level or inside an `AND`/`OR`/`NOT` combinator, which all operate
 * on the same model.
 *
 * It deliberately does NOT descend into relation-filter keys (e.g.
 * `where: { inbox: { deletedAt: { not: null } } }` on an EmailMessage query):
 * that `deletedAt` belongs to the related model, not this one, so treating it
 * as the escape hatch would drop the primary model's filter and leak deleted
 * rows. When in doubt, we inject — the safe direction.
 */
function constrainsOwnDeletedAt(where: Record<string, unknown>): boolean {
  if ('deletedAt' in where) return true

  for (const operator of LOGICAL_OPERATORS) {
    const branch = where[operator]
    if (!branch || typeof branch !== 'object') continue
    const clauses = Array.isArray(branch) ? branch : [branch]
    for (const clause of clauses) {
      if (
        clause &&
        typeof clause === 'object' &&
        constrainsOwnDeletedAt(clause as Record<string, unknown>)
      ) {
        return true
      }
    }
  }
  return false
}

/**
 * Adds `deletedAt: null` to a query's where clause.
 *
 * If the caller already constrains this model's own `deletedAt` — top level or
 * inside `AND`/`OR`/`NOT` — the where is left untouched. That is the deliberate
 * escape hatch for views that need deleted rows, e.g.
 * `where: { deletedAt: { not: null } }` or the same nested in a combinator. A
 * `deletedAt` on a related model (relation filter) is not the escape hatch and
 * still gets the top-level filter injected — see `constrainsOwnDeletedAt`.
 */
export function applySoftDeleteFilter(args: QueryArgs): Record<string, unknown> {
  const next = (args ?? {}) as Record<string, unknown>
  const where = (next.where ?? {}) as Record<string, unknown>

  if (constrainsOwnDeletedAt(where)) {
    return next
  }

  return { ...next, where: { ...where, deletedAt: null } }
}
