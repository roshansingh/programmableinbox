import { z } from 'zod'

/**
 * Normalises a blank environment variable to "unset".
 *
 * `FOO=` in a `.env` file yields `""`, which means "not configured", not
 * "configured with an invalid value" — and `.env.example` ships several such
 * lines (`JWT_SECRET=`, `WEBHOOK_SECRET=`). Without this, a missing required
 * var would be reported as a format violation rather than as absent, and an
 * optional var with a blank line would fail the whole boot.
 *
 * The value itself is returned untrimmed; individual schemas decide whether
 * surrounding whitespace is meaningful.
 */
export function emptyAsUndefined(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  return raw.trim() === '' ? undefined : raw
}

const TRUE_VALUES = ['true', '1', 'yes', 'on'] as const
const FALSE_VALUES = ['false', '0', 'no', 'off'] as const

const TRUE_SET: ReadonlySet<string> = new Set(TRUE_VALUES)
const FALSE_SET: ReadonlySet<string> = new Set(FALSE_VALUES)

/**
 * The single boolean coercion.
 *
 * Previously hand-rolled as `=== 'true'` in five separate places, which read
 * `"TRUE"`, `"1"` and `"yes"` as false. Anything outside the documented set is
 * rejected rather than quietly treated as false, so a typo in a feature flag
 * cannot silently disable the feature.
 */
export const zBool = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .superRefine((value, ctx) => {
    if (!TRUE_SET.has(value) && !FALSE_SET.has(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `must be one of: ${[...TRUE_VALUES, ...FALSE_VALUES].join(', ')}`,
      })
    }
  })
  .transform((value) => TRUE_SET.has(value))

/**
 * The single integer coercion, bounded on both ends.
 *
 * Replaces `parsePositiveInt`, which returned its fallback for any unparseable
 * input — making `WEBHOOK_QUEUE_MAX_RETRIES=abc` indistinguishable from an
 * unset var.
 *
 * `z.coerce.number()` is deliberately avoided: it maps `""` to `0` and accepts
 * anything `Number()` tolerates (`"1e2"`, `" 5 "`). An environment variable
 * that is meant to be an integer must look like one and nothing else.
 */
export function zBoundedInt(min: number, max: number) {
  return z
    .string()
    .regex(/^-?\d+$/, { message: 'must be an integer' })
    .transform((value) => Number.parseInt(value, 10))
    .pipe(z.number().int().min(min).max(max))
}

/**
 * A parseable absolute URL, optionally restricted to a protocol allowlist.
 *
 * Uses `new URL()` rather than `z.string().url()` so the protocol and host
 * checks have the parsed value to work with, and so a malformed `REDIS_URL`
 * fails here at config-read time instead of throwing from deep inside
 * `buildRedisOptions()` on the first connection attempt.
 *
 * A host is required. `new URL()` alone is far too permissive for this job:
 * `new URL('localhost:6379')` succeeds, yielding the protocol `localhost:` and
 * an empty host. That is the input `buildRedisOptions()` used to rewrite to
 * `127.0.0.1` without a word.
 */
export function zUrl(protocols?: readonly string[]) {
  return z.string().superRefine((value, ctx) => {
    let parsed: URL
    try {
      parsed = new URL(value)
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must be a valid URL' })
      return
    }

    if (parsed.hostname === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'must be a valid URL including a host (e.g. redis://localhost:6379)',
      })
      return
    }

    if (protocols && !protocols.includes(parsed.protocol)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `must use one of these protocols: ${protocols.join(', ')}`,
      })
    }
  })
}

/**
 * Canonicalises a web origin for comparison, or returns null if the value is
 * not one.
 *
 * The single definition of "what counts as an origin here", used by the
 * `MCP_ALLOWED_ORIGINS` schema (which rejects anything this returns null for,
 * at boot) and by `checkOrigin` at request time. Two copies would be two
 * answers to the same question, and the failure that produces — config accepts
 * a value the comparison then ignores — is exactly what boot validation exists
 * to prevent.
 *
 * Three rejections, each for a different reason:
 *
 * - **Unparseable** (`app.example.com`, no scheme) — `new URL` throws.
 * - **No host** (`localhost:4000`) — `new URL` *succeeds*, yielding the
 *   protocol `localhost:` and an empty host. Same trap `zUrl` documents; it is
 *   why an empty `hostname` is checked rather than trusting the parse.
 * - **No well-defined origin** (`chrome-extension://abc`, `vscode-webview://x`)
 *   — non-special schemes serialise their origin as the literal string
 *   `"null"`, which is also what a sandboxed iframe or a `data:` document
 *   sends. Such a value can never be compared meaningfully, so allowlisting one
 *   is a request that cannot be honored; saying so at boot beats accepting it
 *   and refusing every request it was meant to admit.
 *
 * Returning the parsed `origin` also normalises away a trailing slash, a path,
 * and an explicit default port, so `https://app.example.com/` and
 * `https://app.example.com:443` both match a browser's `https://app.example.com`.
 */
export function normalizeOrigin(value: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }

  if (parsed.hostname === '') return null
  if (parsed.origin === 'null') return null

  return parsed.origin
}

/** A string that must not be blank once trimmed. */
export const zNonEmpty = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length > 0, { message: 'must not be empty' })
