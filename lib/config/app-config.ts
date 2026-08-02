import 'server-only'
import { config } from './index'

/**
 * Server-side configuration the browser is allowed to see (issue #98).
 *
 * Delivered as one general-purpose object on `GET /api/app/auth/me`, which
 * `AuthProvider` already fetches exactly once on mount — so client-visible
 * config costs no extra round-trip, and future additions (feature flags,
 * limits, retention windows) have an obvious home rather than accreting as
 * per-feature endpoints.
 *
 * Deliberately not `NEXT_PUBLIC_*`: those are inlined at build time, so
 * changing the inbox domain list would mean rebuilding the image instead of
 * restarting the container.
 *
 * **This type is the review gate.** Every field here is published to every
 * authenticated user, so it is an explicit allowlist in the same spirit as
 * `lib/serializers/*` — a value reaches the browser because someone added it
 * here, never because it happened to be in the environment. Nothing secret goes
 * in it. `lib/config/__tests__/app-config.test.ts` asserts the exact key set so
 * an addition cannot pass review unnoticed.
 */
export type AppConfig = {
  /**
   * Domains an inbox may be created at, in operator-declared order; the first
   * is the create dialog's default selection. Empty means inbox creation is not
   * configured, and the dialog must render its disabled state rather than
   * letting the user submit something the server will reject with a 503.
   *
   * Safe to publish: these are the public MX destinations of the service, and
   * they appear in every address the product hands out.
   */
  emailInboxDomains: string[]

  /**
   * Whether this deployment requires a verified email address before the
   * dashboard opens (issue #102).
   *
   * Safe to publish: an unverified user discovers it on their next 403
   * regardless, and a verified one learns only that the deployment has the
   * feature switched on.
   *
   * `useAuth()` falls back to `false` when the server sends no config, which is
   * the correct empty reading here — "feature unavailable", so the client shows
   * the dashboard and lets the server's 403 be the authority. The gate is
   * server-side; this field only decides which screen to render.
   */
  emailVerificationRequired: boolean
}

/**
 * Built per call, but the values come from `config`, which parses each domain
 * once per process. An operator changing EMAIL_INBOX_DOMAINS therefore takes
 * effect on restart — not on a rebuild, which is what a `NEXT_PUBLIC_*` var
 * would have required.
 *
 * Distinct from `lib/config/client.ts`, which is build-time `NEXT_PUBLIC_*`
 * config inlined into the browser bundle. This is *runtime* server config
 * delivered over HTTP, which is why it can change without rebuilding.
 */
export function getAppConfig(): AppConfig {
  return {
    emailInboxDomains: config.emailInbox.domains,
    emailVerificationRequired: config.emailVerification.enabled,
  }
}
