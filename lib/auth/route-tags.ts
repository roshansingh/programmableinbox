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

const ROUTE_TAG = Symbol.for('inboxui.routeTag')

export function tagHandler<T>(handler: T, tag: RouteTag): T {
  Object.defineProperty(handler as object, ROUTE_TAG, {
    value: tag,
    enumerable: false,
    writable: false,
    configurable: false,
  })
  return handler
}

export function getHandlerTag(handler: unknown): RouteTag | null {
  if (typeof handler !== 'function') return null
  const tag = (handler as unknown as Record<symbol, unknown>)[ROUTE_TAG]
  return tag === 'user' || tag === 'apiKey' || tag === 'public' ? tag : null
}
