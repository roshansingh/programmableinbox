/**
 * The external API surface is read-only (see the 2026-07-30 split spec §3.1),
 * so there are no write scopes. `messages:delete` was retired: it gated a
 * destructive operation that is now reachable only from the dashboard.
 */
export const API_KEY_SCOPES = ['inboxes:read', 'messages:read'] as const

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number]

/**
 * Enumerated explicitly rather than spread from API_KEY_SCOPES. The spread is
 * how the previous default came to include `messages:delete` — a scope added
 * for one purpose silently became a default grant for every new key. When a
 * write scope is eventually added it must be an opt-in, which requires this
 * list to be a deliberate subset rather than a mirror.
 */
export const DEFAULT_API_KEY_SCOPES: ApiKeyScope[] = ['inboxes:read', 'messages:read']

export const API_KEY_SCOPE_SET = new Set<string>(API_KEY_SCOPES)

/**
 * Credential discrimination depends on this being the sole source of truth.
 * Adding a `sk_test_` tier later is a single-site change here plus the
 * corresponding branch in `lib/auth/with-auth.ts`.
 */
export const API_KEY_PREFIX = 'sk_live_'
