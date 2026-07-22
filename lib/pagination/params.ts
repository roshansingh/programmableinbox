/**
 * Bounds for offset (`page`/`limit`) pagination on list endpoints.
 *
 * Every list endpoint reads `limit` (and often `page`) straight off the query
 * string, so both are attacker-controlled. Without bounds, `?limit=100000000`
 * makes Prisma materialise and serialise an entire table, `?limit=-1` flips
 * Prisma's `take` semantics to "count back from the end", and `?page=abc`
 * yields `skip: NaN`, which Prisma rejects with an unhandled 500.
 *
 * Parsing here is deliberately strict — a value is only accepted when it is a
 * plain decimal integer string. This mirrors `decodeCursor` in ./cursor.ts,
 * which rejects `"1e12"`, `" 12 "` and `"Infinity"` for the same reason:
 * `parseInt`/`Number` coercion is far too eager to be a trust boundary. In
 * particular `parseInt('12abc')` returns `12`, silently accepting garbage — we
 * reject it and fall back to the default instead.
 */

/** Default rows per page when the caller does not ask for a specific `limit`. */
export const DEFAULT_LIMIT = 50

/**
 * Hard ceiling on rows per page.
 *
 * 100 matches the clamp the messages endpoint already applied and the
 * "max: 100" already published in the OpenAPI document (lib/openapi).
 */
export const MAX_LIMIT = 100

/**
 * Hard ceiling on `OFFSET`. Postgres walks and discards every skipped row, so a
 * large offset is expensive even when `limit` is small. Callers that need to go
 * deeper than this should use the keyset cursor in ./cursor.ts.
 */
export const MAX_OFFSET = 10_000

/**
 * Safety ceiling for list queries that expose no pagination parameters at all
 * (inboxes, API keys, automations). These are tenant-scoped and normally tiny,
 * but an unbounded `findMany` still lets one request materialise a whole table.
 */
export const MAX_UNPAGINATED_ROWS = 500

/** Thrown when the requested page would produce an offset beyond `MAX_OFFSET`. */
export class OffsetTooLargeError extends Error {
  readonly maxOffset: number

  constructor(maxOffset: number) {
    super(`Requested page exceeds the maximum offset of ${maxOffset} rows`)
    this.name = 'OffsetTooLargeError'
    this.maxOffset = maxOffset
  }
}

/** Digits only: rejects "-1", "1e9", "12abc", "50.5", " 12 ", "Infinity", "". */
const DECIMAL_INTEGER = /^\d+$/

/**
 * Returns the numeric value of `raw` when it is a non-negative integer (either
 * a real `number` or a plain decimal string), otherwise `null`.
 *
 * Digit strings longer than ~309 characters coerce to `Infinity`; that is fine
 * because every caller clamps with `Math.min` afterwards.
 */
function toNonNegativeInteger(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw >= 0 ? raw : null
  }
  if (typeof raw === 'string' && DECIMAL_INTEGER.test(raw)) {
    return Number(raw)
  }
  return null
}

export interface LimitOptions {
  /** Used when `raw` is absent or unparseable. Defaults to `DEFAULT_LIMIT`. */
  defaultLimit?: number
  /** Upper bound. Defaults to `MAX_LIMIT`. */
  maxLimit?: number
}

/**
 * Parses a caller-supplied page size into `[1, maxLimit]`.
 *
 * Anything that is not a plain non-negative integer (missing, empty, negative,
 * float, `"1e9"`, `"Infinity"`, `"12abc"`) falls back to `defaultLimit`; `0` and
 * absurdly large values are clamped into range. Never returns `NaN`.
 */
export function clampLimit(raw: unknown, options: LimitOptions = {}): number {
  const defaultLimit = options.defaultLimit ?? DEFAULT_LIMIT
  const maxLimit = options.maxLimit ?? MAX_LIMIT

  const parsed = toNonNegativeInteger(raw)
  const value = parsed === null ? defaultLimit : parsed
  return Math.min(Math.max(value, 1), maxLimit)
}

/**
 * Parses a caller-supplied 1-based page number.
 *
 * Anything unparseable or below 1 becomes 1. Large-but-valid pages are returned
 * as-is; `parsePagination` is what rejects them once the offset is known.
 */
export function clampPage(raw: unknown): number {
  const parsed = toNonNegativeInteger(raw)
  return parsed === null ? 1 : Math.max(parsed, 1)
}

export interface Pagination {
  page: number
  limit: number
  /** `(page - 1) * limit`, guaranteed finite and `<= MAX_OFFSET`. */
  skip: number
}

export interface PaginationOptions extends LimitOptions {
  /** Upper bound on `skip`. Defaults to `MAX_OFFSET`. */
  maxOffset?: number
}

/**
 * Parses and bounds `page`/`limit` from a query string.
 *
 * @throws {OffsetTooLargeError} when `(page - 1) * limit > maxOffset`. Routes
 * translate this to a 400 rather than silently serving a different page, which
 * would be a correctness lie to the client.
 */
export function parsePagination(
  searchParams: URLSearchParams,
  options: PaginationOptions = {},
): Pagination {
  const maxOffset = options.maxOffset ?? MAX_OFFSET

  const limit = clampLimit(searchParams.get('limit'), options)
  const page = clampPage(searchParams.get('page'))
  const skip = (page - 1) * limit

  if (skip > maxOffset) {
    throw new OffsetTooLargeError(maxOffset)
  }

  return { page, limit, skip }
}
