/**
 * Query-string parsing for message search (issue #106).
 *
 * Shared verbatim by `app/api/app/emailInbox/[id]/messages` and
 * `app/api/v1/emailInbox/[id]/messages` — the two surfaces are required to
 * accept exactly the same parameters, and the only way to keep that true over
 * time is for there to be one parser rather than two that agree today.
 *
 * Parsing is strict in the same spirit as `lib/pagination/params.ts`: a bad
 * value produces a 400 naming the parameter, never a silently different query.
 * The one deliberate exception is *absence* — an empty or whitespace-only value
 * means "the caller did not filter on this", because a UI that binds a search
 * box to `?q=` sends `q=` on every keystroke-cleared render, and answering that
 * with a 400 would be hostile.
 */

/**
 * Cap on `q` and `from`, in characters.
 *
 * Both reach Postgres: `q` through `websearch_to_tsquery`, `from` as an `ILIKE`
 * pattern. Neither is a injection risk (every value is a bound parameter), but
 * both are work the database does per row, and an unbounded pattern is a cheap
 * way to make an expensive query.
 */
export const MAX_QUERY_LENGTH = 200

/** Cap on how many `tags` / `categories` values one request may filter on. */
export const MAX_FILTER_VALUES = 20

/**
 * A caller-supplied search parameter that cannot be honored.
 *
 * Carries a client-safe message; routes translate it straight to
 * `jsonError(error.message, 400)`. Mirrors `OffsetTooLargeError` in
 * `lib/pagination/params.ts` — rejecting is correct where the alternative is
 * silently running a *different* query than the one that was asked for.
 */
export class SearchParamError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SearchParamError'
  }
}

export interface MessageSearch {
  /** Full-text query over subject and body. Null when not filtering on it. */
  q: string | null
  /** Case-insensitive substring of the `from` header. Null when not filtering. */
  from: string | null
  /** Exact tag values, OR-combined. Empty when not filtering. */
  tags: string[]
  /** Exact category values, OR-combined. Empty when not filtering. */
  categories: string[]
}

export interface ParseMessageSearchOptions {
  /** The raw `grouped` flag from the request. */
  grouped: boolean
  /**
   * The requested thread, if any. Taken because grouping and a thread filter are
   * not independent — see the conflict check in `parseMessageSearch`.
   */
  threadId?: string | null
}

/**
 * Parses the search parameters, or returns null when the request does not
 * search at all.
 *
 * Null rather than an all-empty object so callers have one unambiguous signal
 * for "use the plain listing path", which keeps the existing query plan for
 * every request that is not a search.
 *
 * @throws {SearchParamError} on an over-long `q`/`from`, too many filter values,
 * or any search parameter combined with `grouped=true`.
 */
export function parseMessageSearch(
  searchParams: URLSearchParams,
  options: ParseMessageSearchOptions,
): MessageSearch | null {
  const q = readText(searchParams, 'q')
  const from = readText(searchParams, 'from')
  const tags = readList(searchParams, 'tags')
  const categories = readList(searchParams, 'categories')

  if (q === null && from === null && tags.length === 0 && categories.length === 0) {
    return null
  }

  // Grouped mode collapses to one row per thread via DISTINCT ON, and every
  // available answer for "what does it mean for a *thread* to match" either
  // changes what `threadCount` counts or returns a row that does not contain the
  // search term. Rejecting is honest; picking one silently is not. The dashboard
  // list defaults to grouped, so the client turns it off when a search is active.
  //
  // Gated on the *effective* flag, not the raw one: `listMessages` already
  // ignores `grouped` whenever `threadId` is set, because collapsing to one row
  // per thread is meaningless inside a single thread. Rejecting on the raw flag
  // would 400 a request with no actual conflict — which bites any client that
  // keeps `grouped=true` in its default query parameters and then drills into a
  // thread. Searching within a thread is well-defined and supported.
  if (isGroupedInEffect(options)) {
    throw new SearchParamError(
      'Search is not supported in grouped mode. Retry with grouped=false.',
    )
  }

  return { q, from, tags, categories }
}

/**
 * Whether the grouped thread-list view is actually in effect.
 *
 * Mirrors the precedence in `listMessages` (`opts.grouped && !opts.threadId`).
 * It lives here, in the module both routes share, rather than being computed at
 * each call site — two routes each deriving the same flag is exactly the drift
 * this parser exists to prevent.
 */
function isGroupedInEffect(options: ParseMessageSearchOptions): boolean {
  return options.grouped && !options.threadId
}

/** True when this request filters on anything at all. */
export function hasMessageSearch(search: MessageSearch | null): search is MessageSearch {
  return search !== null
}

function readText(searchParams: URLSearchParams, name: string): string | null {
  const raw = searchParams.get(name)
  if (raw === null) return null

  const value = raw.trim()
  if (!value) return null

  if (value.length > MAX_QUERY_LENGTH) {
    throw new SearchParamError(`${name} must be at most ${MAX_QUERY_LENGTH} characters`)
  }

  return value
}

/**
 * Reads a filter that accepts both `?tags=a&tags=b` and `?tags=a,b`.
 *
 * Both forms are supported because both are what callers actually send —
 * `URLSearchParams.append` in a browser client produces the first, hand-written
 * curl and the OpenAPI `form`/`csv` style produce the second.
 */
function readList(searchParams: URLSearchParams, name: string): string[] {
  const values = searchParams
    .getAll(name)
    .flatMap((raw) => raw.split(','))
    .map((value) => value.trim())
    .filter(Boolean)

  const unique = [...new Set(values)]

  // Rejected rather than truncated: a silently dropped filter value returns rows
  // the caller asked to exclude, or hides rows they asked for, with a 200 and no
  // indication anything was ignored.
  if (unique.length > MAX_FILTER_VALUES) {
    throw new SearchParamError(`${name} accepts at most ${MAX_FILTER_VALUES} values`)
  }

  for (const value of unique) {
    if (value.length > MAX_QUERY_LENGTH) {
      throw new SearchParamError(
        `${name} values must be at most ${MAX_QUERY_LENGTH} characters`,
      )
    }
  }

  return unique
}
