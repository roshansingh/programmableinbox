import { z } from 'zod'
import { Secret, zSecret } from './secret'
import { zBool, zBoundedInt, zNonEmpty, zUrl } from './primitives'

// ---------------------------------------------------------------------------
// Closed value sets
// ---------------------------------------------------------------------------

/** Pino's complete set of accepted level strings. */
export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const
export const LLM_PROVIDERS = ['anthropic', 'openai', 'openrouter', 'ollama'] as const
export const NODE_ENVS = ['development', 'test', 'production'] as const

export type LogLevel = (typeof LOG_LEVELS)[number]
export type LlmProviderName = (typeof LLM_PROVIDERS)[number]

export const DEFAULT_WEBHOOK_QUEUE_MAX_RETRIES = 3
export const DEFAULT_WEBHOOK_QUEUE_CONCURRENCY_PER_INBOX = 5

// ---------------------------------------------------------------------------
// Cross-cutting refinements
// ---------------------------------------------------------------------------

/**
 * Whether a Postgres URL pins the session timezone to UTC.
 *
 * Checked semantically rather than by substring. The two encodings below are
 * the same option, and `URLSearchParams.set` — which
 * `test/integration/setup/db-url.ts` uses — produces the second:
 *
 *     options=-c%20timezone%3DUTC
 *     options=-c+timezone%3DUTC
 *
 * A literal `includes('options=-c%20timezone%3DUTC')` would reject a correctly
 * configured integration-test database.
 *
 * Why it matters: Prisma sends timestamps as naive strings, so Postgres
 * interprets them in the *session* timezone before storing them in
 * `timestamptz`. A non-UTC session stores every timestamp shifted by the local
 * offset. Prisma reverses the shift on read, so the ORM looks correct while raw
 * SQL sees the wrong instant — which silently broke the grouped-threads cursor
 * pagination. See CLAUDE.md.
 */
function hasUtcSessionTimezone(raw: string): boolean {
  try {
    const options = new URL(raw).searchParams.get('options') ?? ''
    return /timezone\s*=\s*UTC/i.test(options)
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Domain schemas
//
// Each takes the raw env slice for its domain (already normalised so that a
// blank value reads as absent) and returns a camel-cased, fully typed object.
// Defaults are applied in the transform rather than via `.default()`, because
// `.default()` on a ZodEffects chain takes the schema's *input* type — it would
// mean writing `.default('3')` for an integer and `.default('false')` for a
// boolean, which reads as a bug even when it is correct.
// ---------------------------------------------------------------------------

const RuntimeSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENVS).optional(),
  })
  .transform((v) => {
    const nodeEnv = v.NODE_ENV ?? 'development'
    return {
      nodeEnv,
      isProduction: nodeEnv === 'production',
      isDevelopment: nodeEnv === 'development',
      isTest: nodeEnv === 'test',
    }
  })

const DbSchema = z
  .object({
    DATABASE_URL: zUrl(['postgresql:', 'postgres:']).refine(hasUtcSessionTimezone, {
      message:
        'must pin the session timezone to UTC (append `options=-c%20timezone%3DUTC`). ' +
        'Without it Postgres stores timestamptz values shifted by the session offset — see CLAUDE.md.',
    }),
  })
  .transform((v) => ({ url: v.DATABASE_URL }))

const AuthSchema = z
  .object({
    // 16 chars is well below a generated `openssl rand -base64 32` (44 chars)
    // but high enough to reject a placeholder someone typed in a hurry.
    JWT_SECRET: zSecret({ min: 16 }),
  })
  .transform((v) => ({ jwtSecret: v.JWT_SECRET }))

const EmailSchema = z
  .object({
    AUTH_RESEND_API_KEY: zSecret(),
    AUTH_EMAIL_FROM: zNonEmpty,
    AUTH_EMAIL_FROM_NAME: zNonEmpty,
  })
  .transform((v) => ({
    resendApiKey: v.AUTH_RESEND_API_KEY,
    from: v.AUTH_EMAIL_FROM,
    fromName: v.AUTH_EMAIL_FROM_NAME,
  }))

const LoggingSchema = z
  .object({
    LOG_LEVEL: z.enum(LOG_LEVELS).optional(),
  })
  // Null rather than a baked-in default: the effective default depends on
  // NODE_ENV (debug in dev, info in prod), which is a different domain.
  .transform((v) => ({ level: v.LOG_LEVEL ?? null }))

const RedisSchema = z
  .object({
    REDIS_URL: zUrl(['redis:', 'rediss:']).optional(),
  })
  /**
   * Null when unset — there is deliberately no `redis://localhost:6379`
   * fallback.
   *
   * A default that points at localhost is the wrong shape for this variable:
   * on a production box where the operator forgot to set it, the app silently
   * dials a Redis that either does not exist (an outage that looks like a
   * network fault) or, worse, is some *other* service's Redis on the same
   * host, at which point two deployments quietly share a queue and a rate
   * limiter. Neither failure names the missing variable.
   *
   * Consumers must handle `null` explicitly. `assertConfig()` additionally
   * requires it to be set whenever async webhook processing is enabled, so
   * the common misconfiguration is caught at boot rather than at first use.
   */
  .transform((v) => ({ url: v.REDIS_URL ?? null }))

const WebhooksSchema = z
  .object({
    WEBHOOK_SECRET: zSecret({ min: 8 }),
    ENABLE_ASYNC_WEBHOOK_PROCESSING: zBool.optional(),
    WEBHOOK_QUEUE_MAX_RETRIES: zBoundedInt(1, 100).optional(),
    WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX: zBoundedInt(1, 1000).optional(),
  })
  .transform((v) => ({
    secret: v.WEBHOOK_SECRET,
    asyncProcessingEnabled: v.ENABLE_ASYNC_WEBHOOK_PROCESSING ?? false,
    maxRetries: v.WEBHOOK_QUEUE_MAX_RETRIES ?? DEFAULT_WEBHOOK_QUEUE_MAX_RETRIES,
    concurrencyPerInbox:
      v.WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX ??
      DEFAULT_WEBHOOK_QUEUE_CONCURRENCY_PER_INBOX,
  }))

const LlmSchema = z
  .object({
    LLM_PROVIDER: z.enum(LLM_PROVIDERS).optional(),
    LLM_API_KEY: zSecret().optional(),
    LLM_MODEL: zNonEmpty.optional(),
    LLM_BASE_URL: zUrl().optional(),
  })
  .superRefine((v, ctx) => {
    // ollama runs locally against an unauthenticated endpoint; every hosted
    // provider needs a credential. Half-configuring one used to mean the
    // adapter was constructed with an empty key and failed on first call.
    if (v.LLM_PROVIDER && v.LLM_PROVIDER !== 'ollama' && !v.LLM_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['LLM_API_KEY'],
        message: `is required when LLM_PROVIDER is "${v.LLM_PROVIDER}"`,
      })
    }
  })
  .transform((v) => ({
    provider: v.LLM_PROVIDER ?? null,
    apiKey: v.LLM_API_KEY ?? null,
    model: v.LLM_MODEL ?? null,
    baseUrl: v.LLM_BASE_URL ?? null,
  }))

const SecuritySchema = z
  .object({
    WEBHOOK_EGRESS_ALLOWLIST: z.string().optional(),
    WEBHOOK_ALLOW_PRIVATE_NETWORK: zBool.optional(),
    HEALTHZ_SECRET: zSecret().optional(),
    AUTOMATION_SWEEPER_SECRET: zSecret().optional(),
  })
  .transform((v) => {
    const entries = (v.WEBHOOK_EGRESS_ALLOWLIST ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)

    return {
      /** Null means "no allowlist", i.e. every public host is permitted. */
      egressAllowlist: entries.length > 0 ? entries : null,
      allowPrivateNetwork: v.WEBHOOK_ALLOW_PRIVATE_NETWORK ?? false,
      healthzSecret: v.HEALTHZ_SECRET ?? null,
      automationSweeperSecret: v.AUTOMATION_SWEEPER_SECRET ?? null,
    }
  })

/**
 * Domains an inbox may be created at (issue #98).
 *
 * Required, and `assertConfig()` refuses to boot without at least one valid
 * entry. That is deliberate rather than defensive: mail only ever reaches this
 * platform for domains verified in Resend and pointed at
 * `POST /api/webhooks/email`, so with no allowlist there is no address the
 * product can hand out that actually works — a server that starts anyway would
 * serve a creation form guaranteed to produce dead inboxes.
 *
 * Malformed entries throw rather than being dropped with a warning. An earlier
 * draft dropped-and-warned per request, which both spammed the log and silently
 * narrowed the allowlist; failing at boot names the typo once, loudly.
 */
const LDH_LABEL = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?'
const DOMAIN_PATTERN = new RegExp(`^${LDH_LABEL}(?:\\.${LDH_LABEL})+$`)

const EmailInboxSchema = z
  .object({
    EMAIL_INBOX_DOMAINS: zNonEmpty,
  })
  .transform((v, ctx) => {
    const seen = new Set<string>()
    const domains: string[] = []
    const malformed: string[] = []

    // Lowercased so comparison happens in the same space as the stored,
    // normalized address (`lib/email-address.ts`); otherwise a mixed-case
    // entry in `.env` would allow nothing.
    for (const entry of v.EMAIL_INBOX_DOMAINS.split(',')) {
      const domain = entry.trim().toLowerCase()
      if (domain === '') continue
      if (!DOMAIN_PATTERN.test(domain)) {
        malformed.push(domain)
        continue
      }
      if (seen.has(domain)) continue
      seen.add(domain)
      domains.push(domain)
    }

    if (malformed.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EMAIL_INBOX_DOMAINS'],
        message: `contains malformed domains (${malformed.join(', ')}) — each must be a dotted, ASCII hostname with no @`,
      })
      return z.NEVER
    }

    if (domains.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EMAIL_INBOX_DOMAINS'],
        message: 'must list at least one domain',
      })
      return z.NEVER
    }

    /** Operator-declared order is preserved; the first is the UI default. */
    return { domains }
  })

const BillingSchema = z
  .object({
    ENABLE_BILLING: zBool.optional(),
  })
  .transform((v) => ({ enabled: v.ENABLE_BILLING ?? false }))

/**
 * Email verification at signup (issue #102).
 *
 * Off by default, which preserves the behaviour every existing deployment
 * already has. Turning it on must be a decision an operator takes, not a side
 * effect of upgrading — a single-user self-hosted instance behind a VPN should
 * not be forced through a mail round-trip it does not need.
 *
 * The two supporting variables are conditionally required, on the `REDIS_URL` /
 * `ENABLE_ASYNC_WEBHOOK_PROCESSING` precedent: null when absent, and consumers
 * reach them through `requireEmailVerification()`, which throws naming them.
 * `assertConfig()` turns "flag on, secret missing" into one loud startup
 * failure rather than a signup that succeeds and mails nobody.
 *
 * `APP_BASE_URL` is deliberately operator configuration rather than the
 * request's `Host` header. Deriving the link origin from the incoming request
 * hands anyone who can set `Host` (or `X-Forwarded-Host`, behind a proxy that
 * forwards it unvalidated) control of the domain in the victim's email — a
 * phishing primitive signed by our own mail domain.
 */
const EmailVerificationSchema = z
  .object({
    ENABLE_EMAIL_VERIFICATION: zBool.optional(),
    // A distinct secret from JWT_SECRET, never the same one. See
    // lib/auth/verification-token.ts — a verification token presented as a
    // session credential must fail signature verification outright.
    EMAIL_VERIFICATION_SECRET: zSecret({ min: 16 }).optional(),
    APP_BASE_URL: zUrl(['http:', 'https:']).optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.ENABLE_EMAIL_VERIFICATION) return

    if (!v.EMAIL_VERIFICATION_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EMAIL_VERIFICATION_SECRET'],
        message: 'is required when ENABLE_EMAIL_VERIFICATION is true',
      })
    }

    if (!v.APP_BASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['APP_BASE_URL'],
        message:
          'is required when ENABLE_EMAIL_VERIFICATION is true — verification links need an absolute origin',
      })
    }
  })
  .transform((v) => ({
    enabled: v.ENABLE_EMAIL_VERIFICATION ?? false,
    secret: v.EMAIL_VERIFICATION_SECRET ?? null,
    appBaseUrl: v.APP_BASE_URL ?? null,
  }))

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * The registry of domains.
 *
 * `vars` is the authoritative list of environment variables a domain reads.
 * The env slice handed to each schema, the aggregated `assertConfig()` report,
 * and the `.env.example` coverage test are all derived from it — so a variable
 * cannot be added to a schema without also becoming documented and validated.
 */
export const DOMAIN_SCHEMAS = {
  runtime: { schema: RuntimeSchema, vars: ['NODE_ENV'] },
  db: { schema: DbSchema, vars: ['DATABASE_URL'] },
  auth: { schema: AuthSchema, vars: ['JWT_SECRET'] },
  email: {
    schema: EmailSchema,
    vars: ['AUTH_RESEND_API_KEY', 'AUTH_EMAIL_FROM', 'AUTH_EMAIL_FROM_NAME'],
  },
  logging: { schema: LoggingSchema, vars: ['LOG_LEVEL'] },
  redis: { schema: RedisSchema, vars: ['REDIS_URL'] },
  webhooks: {
    schema: WebhooksSchema,
    vars: [
      'WEBHOOK_SECRET',
      'ENABLE_ASYNC_WEBHOOK_PROCESSING',
      'WEBHOOK_QUEUE_MAX_RETRIES',
      'WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX',
    ],
  },
  llm: {
    schema: LlmSchema,
    vars: ['LLM_PROVIDER', 'LLM_API_KEY', 'LLM_MODEL', 'LLM_BASE_URL'],
  },
  security: {
    schema: SecuritySchema,
    vars: [
      'WEBHOOK_EGRESS_ALLOWLIST',
      'WEBHOOK_ALLOW_PRIVATE_NETWORK',
      'HEALTHZ_SECRET',
      'AUTOMATION_SWEEPER_SECRET',
    ],
  },
  billing: { schema: BillingSchema, vars: ['ENABLE_BILLING'] },
  emailInbox: { schema: EmailInboxSchema, vars: ['EMAIL_INBOX_DOMAINS'] },
  emailVerification: {
    schema: EmailVerificationSchema,
    vars: ['ENABLE_EMAIL_VERIFICATION', 'EMAIL_VERIFICATION_SECRET', 'APP_BASE_URL'],
  },
} as const satisfies Record<string, { schema: z.ZodTypeAny; vars: readonly string[] }>

export type DomainName = keyof typeof DOMAIN_SCHEMAS

/** The fully parsed shape of every domain — what `config` exposes. */
export type ConfigShape = {
  [K in DomainName]: z.infer<(typeof DOMAIN_SCHEMAS)[K]['schema']>
}

export { Secret }
