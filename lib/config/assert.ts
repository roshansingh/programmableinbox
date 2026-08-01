import 'server-only'
import { ConfigError, parseDomain } from './index'
import { DOMAIN_SCHEMAS, type DomainName } from './schema'

/**
 * Validates every configuration domain and reports all failures at once.
 *
 * Called from the root `instrumentation.ts` at server boot, so a misconfigured
 * deployment fails immediately and completely rather than at whichever request
 * first happens to touch the broken variable. Fixing misconfiguration one
 * crash at a time is the current experience with `getJwtSecret()`; this is the
 * fix for that.
 *
 * Deliberately not invoked at module load — `next build` evaluates every module
 * with no secrets in the environment.
 *
 * @throws {ConfigError} listing every offending variable and its constraint,
 * never any value.
 */
export function assertConfig(): void {
  const failures: string[] = []
  const variables: string[] = []

  for (const domain of Object.keys(DOMAIN_SCHEMAS) as DomainName[]) {
    try {
      parseDomain(domain)
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error
      failures.push(error.message)
      variables.push(...error.variables)
    }
  }

  // Cross-domain requirements on REDIS_URL. Both the webhook queue and the auth
  // rate limiter dial Redis, and REDIS_URL has no default — so an absent or
  // malformed one is a boot-time failure rather than a first-connection one.
  // Checked here rather than in a schema because each spans two domains, and
  // only when Redis itself parsed, so the operator does not get the same
  // variable reported twice.
  if (!variables.includes('REDIS_URL')) {
    const webhooks = safeParse('webhooks')
    const rateLimit = safeParse('rateLimit')
    const redis = safeParse('redis')
    const redisMissing = redis?.url == null

    const requiredBy: string[] = []
    if (webhooks?.asyncProcessingEnabled) requiredBy.push('ENABLE_ASYNC_WEBHOOK_PROCESSING')
    // Unlike the queue, an unbacked limiter does not fail visibly: it returns
    // "allowed" for every request and the only symptom is a log line. Refusing
    // to boot is what makes "auth rate limiting is off" a decision rather than
    // an oversight. Opt out with AUTH_RATE_LIMIT_ENABLED=false.
    if (rateLimit?.enabled) requiredBy.push('AUTH_RATE_LIMIT_ENABLED')

    if (redisMissing && requiredBy.length > 0) {
      failures.push(
        'Invalid redis configuration:\n  - REDIS_URL is required when ' +
          `${requiredBy.join(' or ')} ${requiredBy.length > 1 ? 'are' : 'is'} enabled, ` +
          'and must be a redis:// or rediss:// URL' +
          (rateLimit?.enabled
            ? '\n    (set AUTH_RATE_LIMIT_ENABLED=false to run without auth rate limiting)'
            : ''),
      )
      variables.push('REDIS_URL')
    }
  }

  if (failures.length === 0) return

  throw new ConfigError(
    'Environment configuration is invalid — refusing to start.\n\n' +
      `${failures.join('\n\n')}\n\n` +
      'See .env.example for the full list of variables and their expected formats.',
    variables,
  )
}

/** Parses a domain, returning null instead of throwing. */
function safeParse<K extends DomainName>(domain: K) {
  try {
    return parseDomain(domain)
  } catch {
    return null
  }
}
