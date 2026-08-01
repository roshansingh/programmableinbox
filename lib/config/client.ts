import { z } from 'zod'

/**
 * Client-visible configuration.
 *
 * Next.js inlines `NEXT_PUBLIC_*` at build time by textually substituting
 * `process.env.NEXT_PUBLIC_FOO`. Dynamic access (`process.env[name]`) is not
 * substituted and reads `undefined` in the browser, so every variable here must
 * be written as a static literal — which is why this file cannot reuse the
 * schema-driven `envSlice()` machinery the server config uses.
 *
 * This module must never import `./index`, `./assert` or `./schema`: those are
 * marked `server-only` and would fail a client build.
 */

/**
 * `.catch` rather than a throw. This parses inside the browser bundle, where a
 * hard failure would white-screen the app over a build-time typo that
 * server-side `assertConfig()` cannot see. The server has no equivalent escape
 * hatch precisely because it *can* fail loudly at boot.
 */
const ApiModeSchema = z.enum(['local', 'external']).catch('local')

export const clientConfig = Object.freeze({
  /**
   * `local` points the browser at same-origin `/api`; `external` is reserved
   * for a standalone API host.
   *
   * Currently informational: `lib/api-client.ts` always builds its base URL
   * from `window.location.origin`, so nothing branches on this yet. It is kept
   * (rather than deleted) because it is already set in every deployed
   * environment and in `.env.test`, and validating it here is what makes a typo
   * visible instead of silent. It is *not* required for the app to boot — see
   * the note in CLAUDE.md.
   */
  apiMode: ApiModeSchema.parse(process.env.NEXT_PUBLIC_API_MODE ?? 'local'),
})

export type ClientConfig = typeof clientConfig
