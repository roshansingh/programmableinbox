/**
 * Wrapper identification for the structural route guards.
 *
 * The guards need to answer "was this handler wrapped, and by which wrapper?"
 * Source-text matching cannot answer it honestly — a grep passes on a comment,
 * and an AST check breaks on refactors. A symbol attached to the returned
 * function can only be present if the wrapper actually ran.
 *
 * The property is non-enumerable so it never leaks into JSON, spreads, or
 * `Object.keys` over a route module's exports.
 */
export type RouteTag = 'user' | 'apiKey' | 'public'

/**
 * What the wrapper recorded about a handler.
 *
 * `allowUnverified` rides along with the tag rather than living in a separate
 * symbol for the same reason the tag exists at all: the guard in
 * lib/__tests__/route-guards.test.ts asserts the exact set of routes that opt
 * out of the email-verification gate (issue #102), and a flag that only the
 * wrapper can set is the only kind that cannot be faked by source text.
 */
export type RouteTagInfo = {
  tag: RouteTag
  /** True only for `withUser({ allowUnverified: true })`. */
  allowUnverified: boolean
}

const ROUTE_TAG = Symbol.for('programmableinbox.routeTag')

export function tagHandler<T>(
  handler: T,
  tag: RouteTag,
  options: { allowUnverified?: boolean } = {},
): T {
  Object.defineProperty(handler as object, ROUTE_TAG, {
    value: Object.freeze({ tag, allowUnverified: options.allowUnverified ?? false }),
    enumerable: false,
    writable: false,
    configurable: false,
  })
  return handler
}

export function getHandlerTagInfo(handler: unknown): RouteTagInfo | null {
  if (typeof handler !== 'function') return null

  const info = (handler as unknown as Record<symbol, unknown>)[ROUTE_TAG]
  if (typeof info !== 'object' || info === null) return null

  const { tag, allowUnverified } = info as Record<string, unknown>
  if (tag !== 'user' && tag !== 'apiKey' && tag !== 'public') return null

  return { tag, allowUnverified: allowUnverified === true }
}

export function getHandlerTag(handler: unknown): RouteTag | null {
  return getHandlerTagInfo(handler)?.tag ?? null
}
