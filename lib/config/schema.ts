/**
 * Zod schemas for every environment variable the server reads.
 *
 * Design rules:
 * - Unset + declared default → the default.
 * - Unset + required → throws.
 * - Set but invalid → always throws; never silently falls back to a default.
 * - Format is validated, not just presence (URLs parse as URLs, enums are
 *   closed sets, ints are bounded positives, secrets are non-empty after trim).
 * - Conditional requirements are enforced with `superRefine` so dependent vars
 *   are checked together.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Shared coercions
// ---------------------------------------------------------------------------

/**
 * Coerces a string env var to a boolean with a documented, closed set of
 * accepted values. Unrecognised values (e.g. "yes", "1", "TRUE") are rejected
 * rather than silently falling back, which is the point of the change from the
 * original `=== 'true'` pattern.
 *
 * Accepted: "true" | "false" (case-insensitive).
 * Empty string and undefined are treated as false (opt-in feature flags default off).
 */
export const envBoolean = z
  .string()
  .optional()
  .transform((val, ctx) => {
    if (val === undefined || val === '') return false
    const lower = val.toLowerCase()
    if (lower === 'true') return true
    if (lower === 'false') return false
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `must be "true" or "false", got "${val}"`,
    })
    return z.NEVER
  })

/**
 * Coerces a string env var to a positive integer within [1, max].
 * Unset → default. Set but non-numeric, ≤ 0, or > max → throws.
 */
export function envPositiveInt(defaultValue: number, max = 100_000) {
  return z.preprocess(
    (val) => (val === undefined || val === '' ? undefined : val),
    z
      .union([z.undefined(), z.string()])
      .transform((val, ctx) => {
        if (val === undefined) return defaultValue
        const n = Number(val)
        if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0 || n > max) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `must be a positive integer between 1 and ${max}, got "${val}"`,
          })
          return z.NEVER
        }
        return n
      }),
  ) as z.ZodType<number>
}

/**
 * A non-empty string after trimming — used for required secrets.
 * The minimum length of 8 is a floor for any secret-shaped string.
 */
export const nonEmptyString = z.string().trim().min(1)

/**
 * Optional non-empty string (trims, then allows undefined).
 * Empty string is treated as "not set" (undefined) — the same as omitting the
 * variable entirely — so `vi.stubEnv('X', '')` in tests behaves like `delete process.env.X`.
 */
export const optionalNonEmptyString = z.preprocess(
  (v) => (v === '' || v === undefined ? undefined : v),
  z.string().trim().min(1).optional(),
) as z.ZodType<string | undefined>

// ---------------------------------------------------------------------------
// Per-domain schemas
// ---------------------------------------------------------------------------

/**
 * True when the connection string sets the Postgres session timezone to UTC.
 *
 * Inspects the *decoded* `options` query parameter rather than substring-matching
 * one particular spelling. All of these are the same correctly-configured URL:
 *
 *   ?options=-c%20timezone%3DUTC      (what .env.example documents)
 *   ?options=-c+timezone%3DUTC        (what URLSearchParams produces — '+' is a space)
 *   ?options=-c TimeZone=UTC          (Postgres parameter names are case-insensitive)
 *   ?options=-c%20timezone%3DUTC%20-c%20statement_timeout%3D5000   (extra settings)
 *
 * A literal substring check rejects every form but the first, which fails a
 * correctly-configured deployment — the opposite of what this validation is for.
 */
export function hasUtcTimezoneOption(raw: string): boolean {
  let options: string | null
  try {
    // searchParams decodes %20/%3D and converts '+' to a space.
    options = new URL(raw).searchParams.get('options')
  } catch {
    return false
  }
  if (!options) return false
  return /(^|\s)-c\s*timezone\s*=\s*UTC(\s|$)/i.test(options)
}

export const DatabaseSchema = z
  .object({
    DATABASE_URL: z
      .string()
      .url({ message: 'DATABASE_URL must be a valid URL' })
      .refine(
        hasUtcTimezoneOption,
        'DATABASE_URL must set the UTC session timezone, e.g. "?options=-c%20timezone%3DUTC". ' +
          'Without it Postgres interprets Prisma timestamps in the server\'s local ' +
          'timezone and stores them shifted — see CLAUDE.md',
      ),
  })

export const AuthSchema = z.object({
  JWT_SECRET: nonEmptyString.min(
    8,
    'JWT_SECRET must be at least 8 characters; generate one with `openssl rand -base64 32`',
  ),
})

export const EmailSchema = z.object({
  AUTH_RESEND_API_KEY: nonEmptyString,
  AUTH_EMAIL_FROM: z.string().email({ message: 'AUTH_EMAIL_FROM must be a valid email address' }),
  AUTH_EMAIL_FROM_NAME: nonEmptyString,
  WEBHOOK_SECRET: nonEmptyString.min(
    8,
    'WEBHOOK_SECRET must be at least 8 characters; copy it from the Resend dashboard',
  ),
})

export const RedisSchema = z.object({
  REDIS_URL: z
    .string()
    .url({ message: 'REDIS_URL must be a valid URL (e.g. redis://localhost:6379)' })
    .default('redis://localhost:6379'),
})

export const WebhookQueueSchema = z.object({
  WEBHOOK_QUEUE_MAX_RETRIES: envPositiveInt(3, 100),
  WEBHOOK_QUEUE_WORKER_CONCURRENCY_PER_INBOX: envPositiveInt(5, 1000),
})

export const LlmSchema = z
  .object({
    LLM_PROVIDER: z.preprocess(
      (v) => (v === '' || v === undefined ? undefined : v),
      z.enum(['anthropic', 'openai', 'openrouter', 'ollama']).optional(),
    ),
    LLM_API_KEY: optionalNonEmptyString,
    LLM_MODEL: optionalNonEmptyString,
    LLM_BASE_URL: z.preprocess(
      (v) => (v === '' || v === undefined ? undefined : v),
      z.string().url().optional(),
    ),
  })
  .superRefine((data, ctx) => {
    if (data.LLM_PROVIDER && data.LLM_PROVIDER !== 'ollama' && !data.LLM_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['LLM_API_KEY'],
        message: `LLM_API_KEY is required when LLM_PROVIDER is "${data.LLM_PROVIDER}"`,
      })
    }
  })

export const LoggingSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  LOG_LEVEL: z
    .preprocess(
      (v) => (v === '' || v === undefined ? undefined : v),
      z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).optional(),
    ),
})

export const SecuritySchema = z.object({
  WEBHOOK_EGRESS_ALLOWLIST: optionalNonEmptyString,
  WEBHOOK_ALLOW_PRIVATE_NETWORK: envBoolean,
})

export const RuntimeSchema = z.object({
    ENABLE_ASYNC_WEBHOOK_PROCESSING: envBoolean,
    ENABLE_BILLING: envBoolean,
    HEALTHZ_SECRET: optionalNonEmptyString,
    AUTOMATION_SWEEPER_SECRET: optionalNonEmptyString,
  })

// ---------------------------------------------------------------------------
// Secret variable names — used by assertConfig to redact values from errors
// ---------------------------------------------------------------------------
export const SECRET_VAR_NAMES = new Set([
  'JWT_SECRET',
  'WEBHOOK_SECRET',
  'AUTH_RESEND_API_KEY',
  'LLM_API_KEY',
  'HEALTHZ_SECRET',
  'AUTOMATION_SWEEPER_SECRET',
])
