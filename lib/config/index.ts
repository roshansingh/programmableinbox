import 'server-only'
import type { z } from 'zod'
import { emptyAsUndefined } from './primitives'
import { DOMAIN_SCHEMAS, type ConfigShape, type DomainName } from './schema'

export {
  DEFAULT_REDIS_URL,
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
 * Only `path` and `message` are read. The input value and `issue.received` are
 * deliberately never touched — that is what keeps secrets out of error output,
 * including for issues zod would otherwise annotate with the received value.
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
