/**
 * Centralized, server-side environment configuration.
 *
 * This is the **single source of truth** for every env var the server reads.
 * All values are zod-validated before any caller can see them.
 *
 * Design rules:
 * - **No module-load validation.** `next build` evaluates every server module
 *   with no secrets in the environment. Every getter is lazy + memoized so
 *   parsing only happens on first access at runtime, never at build time.
 * - **Set-but-invalid always throws.** An invalid value never silently falls
 *   back to a default — that is the core invariant.
 * - **Secrets cannot be accidentally logged.** Each secret field is wrapped in
 *   a `Secret` instance whose `toString`/`toJSON`/inspect returns "[REDACTED]".
 * - **assertConfig() at boot.** Call once from lib/instrumentation.ts to
 *   collect and report every misconfigured variable in one pass.
 *
 * Usage:
 *   import { config } from '@/lib/config'
 *   const url = config.db.url           // string
 *   const secret = config.auth.jwtSecret.reveal()  // string (use sparingly)
 */

import 'server-only'
import { z, ZodError } from 'zod'
import {
  AuthSchema,
  DatabaseSchema,
  EmailSchema,
  LlmSchema,
  LoggingSchema,
  RedisSchema,
  RuntimeSchema,
  SECRET_VAR_NAMES,
  SecuritySchema,
  WebhookQueueSchema,
} from './schema'

// ---------------------------------------------------------------------------
// Secret wrapper — prevents accidental log / serialization of sensitive values
// ---------------------------------------------------------------------------

/**
 * Wraps a sensitive string so it cannot leak into Pino output or error dumps.
 *
 * - `toString()` → "[REDACTED]"
 * - `toJSON()` → "[REDACTED]"
 * - `util.inspect` → "[REDACTED]"
 * - `reveal()` → the actual value (call only where the secret is needed)
 */
export class Secret {
  readonly #value: string

  constructor(value: string) {
    this.#value = value
  }

  /** Returns the raw secret value. Use only where the secret is required. */
  reveal(): string {
    return this.#value
  }

  toString(): string {
    return '[REDACTED]'
  }

  toJSON(): string {
    return '[REDACTED]'
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return '[REDACTED]'
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Redacts any value whose variable name is in SECRET_VAR_NAMES before
 * including it in an error message or log line.
 */
function redactIssues(issues: z.ZodIssue[]): z.ZodIssue[] {
  return issues.map((issue) => {
    const varName = issue.path[0]
    if (typeof varName === 'string' && SECRET_VAR_NAMES.has(varName)) {
      return { ...issue, message: issue.message.replace(/got ".+?"/, 'got [REDACTED]') }
    }
    return issue
  })
}

function parseOrThrow<T>(schema: z.ZodType<T>, data: Record<string, string | undefined>): T {
  return schema.parse(data)
}

// ---------------------------------------------------------------------------
// Memoized parsed sections
// ---------------------------------------------------------------------------

let _db: { url: string } | undefined
let _auth: { jwtSecret: Secret } | undefined
let _email: { resendApiKey: Secret; emailFrom: string; emailFromName: string; webhookSecret: Secret } | undefined
let _redis: { url: string } | undefined
let _webhookQueue: { maxRetries: number; concurrencyPerInbox: number } | undefined
let _llm: { provider: 'anthropic' | 'openai' | 'openrouter' | 'ollama' | undefined; apiKey: Secret | undefined; model: string | undefined; baseUrl: string | undefined } | undefined
let _logging: { nodeEnv: 'development' | 'production' | 'test'; logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent' | undefined } | undefined
let _security: { egressAllowlist: string | undefined; allowPrivateNetwork: boolean } | undefined
let _runtime: { asyncWebhookProcessing: boolean; billing: boolean; healthzSecret: string | undefined; sweeperSecret: string | undefined } | undefined

function getDb() {
  if (!_db) {
    const raw = parseOrThrow(DatabaseSchema, { DATABASE_URL: process.env.DATABASE_URL })
    _db = { url: raw.DATABASE_URL }
  }
  return _db
}

function getAuth() {
  if (!_auth) {
    const raw = parseOrThrow(AuthSchema, { JWT_SECRET: process.env.JWT_SECRET })
    _auth = { jwtSecret: new Secret(raw.JWT_SECRET) }
  }
  return _auth
}

function getEmail() {
  if (!_email) {
    const raw = parseOrThrow(EmailSchema, {
      AUTH_RESEND_API_KEY: process.env.AUTH_RESEND_API_KEY,
      AUTH_EMAIL_FROM: process.env.AUTH_EMAIL_FROM,
      AUTH_EMAIL_FROM_NAME: process.env.AUTH_EMAIL_FROM_NAME,
      WEBHOOK_SECRET: process.env.WEBHOOK_SECRET,
    })
    _email = {
      resendApiKey: new Secret(raw.AUTH_RESEND_API_KEY),
      emailFrom: raw.AUTH_EMAIL_FROM,
      emailFromName: raw.AUTH_EMAIL_FROM_NAME,
      webhookSecret: new Secret(raw.WEBHOOK_SECRET),
    }
  }
  return _email
}

function getRedis() {
  if (!_redis) {
    const raw = parseOrThrow(RedisSchema, { REDIS_URL: process.env.REDIS_URL })
    _redis = { url: raw.REDIS_URL }
  }
  return _redis
}

function getWebhookQueue() {
  if (!_webhookQueue) {
    const raw = parseOrThrow(WebhookQueueSchema, {
      WEBHOOK_QUEUE_MAX_RETRIES: process.env.WEBHOOK_QUEUE_MAX_RETRIES,
      WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX: process.env.WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX,
    })
    _webhookQueue = {
      maxRetries: raw.WEBHOOK_QUEUE_MAX_RETRIES,
      concurrencyPerInbox: raw.WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX,
    }
  }
  return _webhookQueue
}

function getLlm() {
  if (!_llm) {
    const raw = parseOrThrow(LlmSchema, {
      LLM_PROVIDER: process.env.LLM_PROVIDER,
      LLM_API_KEY: process.env.LLM_API_KEY,
      LLM_MODEL: process.env.LLM_MODEL,
      LLM_BASE_URL: process.env.LLM_BASE_URL,
    })
    _llm = {
      provider: raw.LLM_PROVIDER,
      apiKey: raw.LLM_API_KEY !== undefined ? new Secret(raw.LLM_API_KEY) : undefined,
      model: raw.LLM_MODEL,
      baseUrl: raw.LLM_BASE_URL,
    }
  }
  return _llm
}

function getLogging() {
  if (!_logging) {
    const raw = parseOrThrow(LoggingSchema, {
      NODE_ENV: process.env.NODE_ENV,
      LOG_LEVEL: process.env.LOG_LEVEL,
    })
    _logging = { nodeEnv: raw.NODE_ENV, logLevel: raw.LOG_LEVEL }
  }
  return _logging
}

function getSecurity() {
  if (!_security) {
    const raw = parseOrThrow(SecuritySchema, {
      WEBHOOK_EGRESS_ALLOWLIST: process.env.WEBHOOK_EGRESS_ALLOWLIST,
      WEBHOOK_ALLOW_PRIVATE_NETWORK: process.env.WEBHOOK_ALLOW_PRIVATE_NETWORK,
    })
    _security = {
      egressAllowlist: raw.WEBHOOK_EGRESS_ALLOWLIST,
      allowPrivateNetwork: raw.WEBHOOK_ALLOW_PRIVATE_NETWORK,
    }
  }
  return _security
}

function getRuntime() {
  if (!_runtime) {
    const raw = parseOrThrow(RuntimeSchema, {
      ENABLE_ASYNC_WEBHOOK_PROCESSING: process.env.ENABLE_ASYNC_WEBHOOK_PROCESSING,
      ENABLE_BILLING: process.env.ENABLE_BILLING,
      HEALTHZ_SECRET: process.env.HEALTHZ_SECRET,
      AUTOMATION_SWEEPER_SECRET: process.env.AUTOMATION_SWEEPER_SECRET,
    })
    _runtime = {
      asyncWebhookProcessing: raw.ENABLE_ASYNC_WEBHOOK_PROCESSING,
      billing: raw.ENABLE_BILLING,
      healthzSecret: raw.HEALTHZ_SECRET,
      sweeperSecret: raw.AUTOMATION_SWEEPER_SECRET,
    }
  }
  return _runtime
}

// ---------------------------------------------------------------------------
// Public config object
// ---------------------------------------------------------------------------

/**
 * Server configuration. Every property is lazily evaluated and memoized —
 * safe to import in route handlers and utilities without breaking `next build`.
 */
export const config = {
  /** Database connection settings. */
  get db() {
    return getDb()
  },
  /** Authentication settings. */
  get auth() {
    return getAuth()
  },
  /** Email / Resend settings. */
  get email() {
    return getEmail()
  },
  /** Redis connection URL (includes default). */
  get redis() {
    return getRedis()
  },
  /** BullMQ webhook queue tuning. */
  get webhookQueue() {
    return getWebhookQueue()
  },
  /** LLM provider settings. */
  get llm() {
    return getLlm()
  },
  /** Logging settings. */
  get logging() {
    return getLogging()
  },
  /** Outbound webhook security settings. */
  get security() {
    return getSecurity()
  },
  /** Feature flags and operational secrets. */
  get runtime() {
    return getRuntime()
  },
}

// ---------------------------------------------------------------------------
// assertConfig — validate all sections at boot
// ---------------------------------------------------------------------------

/** Clears all memoized config sections. For testing only. */
export function _resetConfigCache(): void {
  _db = undefined
  _auth = undefined
  _email = undefined
  _redis = undefined
  _webhookQueue = undefined
  _llm = undefined
  _logging = undefined
  _security = undefined
  _runtime = undefined
}

/**
 * Validates every environment variable and throws a single aggregated error
 * listing all problems if any are found.
 *
 * Call this once at server boot from `lib/instrumentation.ts`. A deployment
 * with any misconfigured variable will fail to start with a clear message
 * instead of discovering problems one request at a time.
 *
 * Safe to call after `next build` because it reads `process.env` at runtime,
 * not at module load time.
 */
export function assertConfig(): void {
  const schemas: Array<{ name: string; schema: z.ZodTypeAny; data: Record<string, string | undefined> }> = [
    { name: 'database', schema: DatabaseSchema, data: { DATABASE_URL: process.env.DATABASE_URL } },
    { name: 'auth', schema: AuthSchema, data: { JWT_SECRET: process.env.JWT_SECRET } },
    {
      name: 'email',
      schema: EmailSchema,
      data: {
        AUTH_RESEND_API_KEY: process.env.AUTH_RESEND_API_KEY,
        AUTH_EMAIL_FROM: process.env.AUTH_EMAIL_FROM,
        AUTH_EMAIL_FROM_NAME: process.env.AUTH_EMAIL_FROM_NAME,
        WEBHOOK_SECRET: process.env.WEBHOOK_SECRET,
      },
    },
    { name: 'redis', schema: RedisSchema, data: { REDIS_URL: process.env.REDIS_URL } },
    {
      name: 'webhookQueue',
      schema: WebhookQueueSchema,
      data: {
        WEBHOOK_QUEUE_MAX_RETRIES: process.env.WEBHOOK_QUEUE_MAX_RETRIES,
        WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX: process.env.WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX,
      },
    },
    {
      name: 'llm',
      schema: LlmSchema,
      data: {
        LLM_PROVIDER: process.env.LLM_PROVIDER,
        LLM_API_KEY: process.env.LLM_API_KEY,
        LLM_MODEL: process.env.LLM_MODEL,
        LLM_BASE_URL: process.env.LLM_BASE_URL,
      },
    },
    {
      name: 'logging',
      schema: LoggingSchema,
      data: { NODE_ENV: process.env.NODE_ENV, LOG_LEVEL: process.env.LOG_LEVEL },
    },
    {
      name: 'security',
      schema: SecuritySchema,
      data: {
        WEBHOOK_EGRESS_ALLOWLIST: process.env.WEBHOOK_EGRESS_ALLOWLIST,
        WEBHOOK_ALLOW_PRIVATE_NETWORK: process.env.WEBHOOK_ALLOW_PRIVATE_NETWORK,
      },
    },
    {
      name: 'runtime',
      schema: RuntimeSchema,
      data: {
        ENABLE_ASYNC_WEBHOOK_PROCESSING: process.env.ENABLE_ASYNC_WEBHOOK_PROCESSING,
        ENABLE_BILLING: process.env.ENABLE_BILLING,
        HEALTHZ_SECRET: process.env.HEALTHZ_SECRET,
        AUTOMATION_SWEEPER_SECRET: process.env.AUTOMATION_SWEEPER_SECRET,
      },
    },
  ]

  const allIssues: string[] = []

  for (const { schema, data } of schemas) {
    const result = schema.safeParse(data)
    if (!result.success) {
      for (const issue of redactIssues((result.error as ZodError).issues)) {
        const varName = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
        allIssues.push(`  ${varName}${issue.message}`)
      }
    }
  }

  if (allIssues.length > 0) {
    throw new Error(
      `Configuration errors (fix before starting the server):\n${allIssues.join('\n')}`,
    )
  }

  // Drop any sections memoized before this point (e.g. by a module that read
  // config during import) so the first real access re-reads the environment we
  // just validated. Each section is parsed again on demand; validation above
  // used safeParse against a separate copy and does not populate the cache.
  _resetConfigCache()
}
