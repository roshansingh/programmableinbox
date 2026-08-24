import 'server-only'
import { PostHog } from 'posthog-node'
import { config, ConfigError } from '@/lib/config'

/**
 * The PostHog server-side client (issue #152).
 *
 * Backed by `globalThis`, not module scope. Next.js (webpack in prod builds,
 * Turbopack in dev) can compile this source file into multiple independent
 * module instances across different chunks/entry points — the identical
 * failure class already hit `CommercialProvider`'s class-static singleton in
 * `lib/commercial/provider.ts`: a value configured once at boot from
 * `instrumentation.ts` was silently read as unconfigured from route handlers
 * compiled into a different chunk (empirically confirmed there: 15 duplicate
 * compiled copies of the class in one `.next/dev/server` build).
 * `globalThis` is the one true JS global shared by the whole process
 * regardless of how many module instances exist, which is the fix already
 * applied to `lib/db.ts`'s Prisma client and `lib/logger.config.ts`'s log
 * transport registry — this client follows the same pattern from the start
 * rather than repeating the bug a third time.
 *
 * Applied unconditionally, not dev-only (unlike `lib/db.ts`'s hot-reload
 * cache): chunk duplication is a build-topology property present in
 * production bundles too, not just a dev-server artifact.
 */
const globalForPostHog = globalThis as unknown as {
  __inboxuiPostHogClient?: PostHog
}

/**
 * Returns the memoised PostHog client, constructing it on first use.
 *
 * Lazy for the same reason `getStripe()` is: `next build` evaluates every
 * module with no secrets present, so a module-scope `new PostHog(...)` would
 * break the build rather than the misconfigured deployment.
 *
 * Callers must check `config.productAnalytics.enabled` first —
 * `captureEvent` (`./capture.ts`) is the only caller, and it does. This
 * function does not check it itself, so a caller that forgot to would get a
 * `ConfigError` naming the missing variables rather than a client
 * constructed with an empty key.
 */
export function getPostHogClient(): PostHog {
  if (globalForPostHog.__inboxuiPostHogClient) {
    return globalForPostHog.__inboxuiPostHogClient
  }

  const { apiKey, host } = config.productAnalytics
  if (!apiKey || !host) {
    // Unreachable through captureEvent, which checks
    // config.productAnalytics.enabled before ever calling this — and
    // assertConfig() refuses to boot with the flag on and either unset.
    // Guarded anyway so a misconfiguration surfaces as a named ConfigError
    // rather than the SDK throwing about an empty key.
    throw new ConfigError(
      'POSTHOG_API_KEY and POSTHOG_HOST are required to talk to PostHog. ' +
        'ENABLE_PRODUCT_ANALYTICS is on, so instrumentation is live, but ' +
        'nothing can be captured without them.',
      ['POSTHOG_API_KEY', 'POSTHOG_HOST'],
    )
  }

  globalForPostHog.__inboxuiPostHogClient = new PostHog(apiKey, { host })
  return globalForPostHog.__inboxuiPostHogClient
}

/** Reset the memoised client. Tests only. */
export function resetPostHogClient(): void {
  globalForPostHog.__inboxuiPostHogClient = undefined
}
