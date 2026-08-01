/**
 * Client-side configuration — NEXT_PUBLIC_* variables only.
 *
 * Next.js statically inlines NEXT_PUBLIC_* at build time. Dynamic access via
 * `process.env[key]` does not work in the browser bundle; each var must be
 * referenced as a string literal here.
 *
 * This module is safe to import from both client and server components.
 * Server-only variables live in `lib/config/index.ts` (server-only).
 *
 * Decision on NEXT_PUBLIC_API_MODE:
 * The variable is consumed here and exposed as `clientConfig.apiMode`.
 * It controls whether the API client hits same-origin routes (the only
 * production mode) or an external URL. It is required to be present because
 * the api-client uses it; set it to "local" for all environments that use
 * same-origin routing.
 */

import { z } from 'zod'

const ClientSchema = z.object({
  NEXT_PUBLIC_API_MODE: z.enum(['local', 'external']).default('local'),
})

const _parsed = ClientSchema.parse({
  NEXT_PUBLIC_API_MODE: process.env.NEXT_PUBLIC_API_MODE,
})

/**
 * Client-safe configuration. Values are parsed once at module load (client
 * bundle evaluation happens once, not per-request, so eager parsing is fine).
 */
export const clientConfig = {
  apiMode: _parsed.NEXT_PUBLIC_API_MODE,
} as const
