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

  // Cross-domain requirement. The queue client and the worker both dial Redis
  // the moment async processing is on, so an unusable REDIS_URL is a boot-time
  // failure rather than a first-connection one. Checked here rather than in a
  // schema because it spans two domains, and only when Redis itself parsed —
  // otherwise the operator gets the same variable reported twice.
  if (!variables.includes('REDIS_URL')) {
    const webhooks = safeParse('webhooks')
    if (webhooks?.asyncProcessingEnabled && safeParse('redis') === null) {
      failures.push(
        'Invalid redis configuration:\n  - REDIS_URL must be a reachable redis:// or ' +
          'rediss:// URL when ENABLE_ASYNC_WEBHOOK_PROCESSING is enabled',
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
