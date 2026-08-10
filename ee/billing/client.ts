import 'server-only'
import Stripe from 'stripe'
import { config, ConfigError } from '@/lib/config'

/**
 * The Stripe client (issue #120).
 *
 * Constructed lazily and memoised, never at module load. `next build`
 * evaluates every module with no secrets present, so a module-scope
 * `new Stripe(...)` would break the build rather than the misconfigured
 * deployment — the same reason `getJwtSecret()` resolves per call.
 *
 * The API version is pinned rather than floating. Stripe changes response
 * shapes between versions, and a client that silently follows the account's
 * default would change behaviour when someone clicks upgrade in the Stripe
 * dashboard, with no commit to point at.
 */
const API_VERSION = '2026-07-29.dahlia' satisfies Stripe.LatestApiVersion

let client: Stripe | undefined

export function getStripe(): Stripe {
  if (client) return client

  const secretKey = config.commercial.stripeSecretKey
  if (!secretKey) {
    // Unreachable through the routes — `assertConfig()` refuses to boot when
    // USE_COMMERCIAL is on without this, and the routes 404 when it is off. This
    // is the guard for a caller that reached here some other way, and it names
    // the variable rather than letting the SDK throw about an empty key.
    throw new ConfigError(
      'STRIPE_SECRET_KEY is required to talk to Stripe. It has no default: ' +
        'USE_COMMERCIAL is on, so plan enforcement is live, but nothing can be ' +
        'sold without it.',
      ['STRIPE_SECRET_KEY'],
    )
  }

  client = new Stripe(secretKey.reveal(), {
    apiVersion: API_VERSION,
    // Surfaces this app in Stripe's request logs, which is what makes a
    // support conversation about a specific charge tractable.
    appInfo: { name: 'ProgrammableInbox' },
    // Stripe's default is 0. A transient network blip on a checkout creation
    // should retry rather than show the customer an error; Stripe's retries are
    // idempotent by request key, so this cannot double-charge.
    maxNetworkRetries: 2,
  })

  return client
}

/** Reset the memoised client. Tests only. */
export function resetStripeClient(): void {
  client = undefined
}

export { API_VERSION as STRIPE_API_VERSION }
