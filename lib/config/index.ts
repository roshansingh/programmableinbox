import 'server-only'
import type { z } from 'zod'
import { emptyAsUndefined } from './primitives'
import { DOMAIN_SCHEMAS, type ConfigShape, type DomainName } from './schema'

export {
  DEFAULT_WEBHOOK_QUEUE_CONCURRENCY_PER_INBOX,
  DEFAULT_WEBHOOK_QUEUE_MAX_RETRIES,
  LLM_PROVIDERS,
  LOG_LEVELS,
  NODE_ENVS,
} from './schema'
export type { ConfigShape, DomainName, LlmProviderName, LogLevel } from './schema'
export { Secret } from './secret'

/**
 * Thrown for any configuration failure.
 *
 * Carries the offending variable *names* so callers can report them, and never
 * the offending values — an error on `JWT_SECRET` must not print the secret.
 */
export class ConfigError extends Error {
  readonly variables: readonly string[]

  constructor(message: string, variables: readonly string[]) {
    super(message)
    this.name = 'ConfigError'
    this.variables = variables
  }
}

/**
 * Renders zod issues as `VAR_NAME <constraint>` lines.
 *
 * Only `path` and `message` are ever emitted; the input value is never read.
 * `issue.received` is consulted below but never printed, and for `invalid_type`
 * it holds a *type name* (`'undefined'`, `'string'`) rather than the value — so
 * comparing against it cannot leak a secret. That is the invariant keeping
 * secrets out of error output.
 */
function formatIssues(domain: DomainName, issues: readonly z.ZodIssue[]): string[] {
  return issues.map((issue) => {
    const head = issue.path[0]
    const name = typeof head === 'string' ? head : `<${domain}>`

    // A missing variable and a malformed one are different operator problems,
    // and zod reports both as invalid_type. Say which one it is.
    const message =
      issue.code === 'invalid_type' && issue.received === 'undefined'
        ? 'is required but not set'
        : issue.message

    return `${name} ${message}`
  })
}

/**
 * Builds the raw environment slice a domain needs, with blank values
 * normalised to absent.
 *
 * Only the variables the domain declares are passed through, so a schema
 * cannot accidentally read something outside its own `vars` list.
 */
function envSlice(domain: DomainName): Record<string, string> {
  const slice: Record<string, string> = {}

  for (const name of DOMAIN_SCHEMAS[domain].vars) {
    const value = emptyAsUndefined(process.env[name])
    if (value !== undefined) slice[name] = value
  }

  return slice
}

/**
 * Parses a single domain, or throws a redacted {@link ConfigError} listing
 * every failure found in it.
 */
export function parseDomain<K extends DomainName>(domain: K): ConfigShape[K] {
  const result = DOMAIN_SCHEMAS[domain].schema.safeParse(envSlice(domain))

  if (result.success) return result.data as ConfigShape[K]

  const lines = formatIssues(domain, result.error.issues)
  const variables = result.error.issues
    .map((issue) => issue.path[0])
    .filter((segment): segment is string => typeof segment === 'string')

  throw new ConfigError(
    `Invalid ${domain} configuration:\n  - ${lines.join('\n  - ')}`,
    variables,
  )
}

const cache = new Map<DomainName, unknown>()

/**
 * Clears the memo.
 *
 * Test seam only — in production each domain is parsed once per process, which
 * is what makes a later `process.env` mutation unable to reintroduce an
 * unvalidated value.
 */
export function resetConfigCache(): void {
  cache.clear()
}

function getDomain<K extends DomainName>(domain: K): ConfigShape[K] {
  if (!cache.has(domain)) {
    cache.set(domain, parseDomain(domain))
  }
  return cache.get(domain) as ConfigShape[K]
}

/**
 * The single source of truth for environment configuration.
 *
 * Every property is a lazy getter returning `z.infer` output. Nothing is parsed
 * at module load, because `next build` evaluates every module with no secrets
 * present — the same constraint that forced `getJwtSecret()` to read per call
 * rather than assert at module scope.
 *
 * Memoisation is per domain, not global. One misconfigured subsystem therefore
 * fails only the code paths that use it, rather than taking down unrelated
 * ones; `assertConfig()` is the single place that demands every domain at once,
 * and it runs at boot.
 */
/**
 * Returns `REDIS_URL`, or throws naming the variable.
 *
 * `config.redis.url` is `string | null` because Redis is optional — a
 * deployment with async webhook processing off never needs it. Every code path
 * that genuinely requires a connection goes through here, so the failure is one
 * consistent message that names the variable, rather than each call site
 * inventing its own or defaulting to localhost.
 */
export function requireRedisUrl(): string {
  const url = config.redis.url

  if (url === null) {
    throw new ConfigError(
      'REDIS_URL is required but not set. It has no default: a localhost ' +
        'fallback would silently connect to the wrong Redis (or none) instead ' +
        'of reporting the missing variable.',
      ['REDIS_URL'],
    )
  }

  return url
}

/**
 * Returns the verification secret and link origin, or throws naming whichever
 * is missing (issue #102).
 *
 * Both are `null` on `config.emailVerification` because the feature is off by
 * default, and the schema only demands them when `ENABLE_EMAIL_VERIFICATION` is
 * true. `assertConfig()` therefore catches the ordinary misconfiguration at
 * boot; this is the guard for the path that stays reachable afterwards — a
 * caller that forgot to check `enabled` first. Same shape as
 * {@link requireRedisUrl}: one message that names the variables, rather than a
 * `null` dereference deep inside the mailer.
 */
export function requireEmailVerification(): { secret: string; appBaseUrl: string } {
  const { secret, appBaseUrl } = config.emailVerification
  const missing: string[] = []

  if (secret === null) missing.push('EMAIL_LINK_SECRET')
  if (appBaseUrl === null) missing.push('APP_BASE_URL')

  if (missing.length > 0) {
    throw new ConfigError(
      `${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} required ` +
        'when ENABLE_EMAIL_VERIFICATION is true. There is no default: every ' +
        'emailed link — verification today, password reset next — needs a ' +
        'signing key that is not JWT_SECRET, and an absolute origin that ' +
        'does not come from the request.',
      missing,
    )
  }

  return { secret: secret!.reveal(), appBaseUrl: appBaseUrl! }
}

export const config: ConfigShape = Object.freeze(
  Object.defineProperties(
    {} as ConfigShape,
    Object.fromEntries(
      (Object.keys(DOMAIN_SCHEMAS) as DomainName[]).map((domain) => [
        domain,
        { get: () => getDomain(domain), enumerable: true },
      ]),
    ) as PropertyDescriptorMap,
  ),
)
