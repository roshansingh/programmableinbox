/**
 * Provider errors for SMS, independent of the Twilio SDK's own error classes.
 *
 * Route handlers catch `SmsProviderError` and branch on `kind`, so a handler
 * never has to know what `RestException` looks like, and a future provider
 * change does not reach them.
 */
export type SmsProviderErrorKind =
  | 'auth'
  | 'invalid-request'
  | 'not-found'
  | 'rate-limited'
  | 'unavailable'
  | 'unknown'

export class SmsProviderError extends Error {
  readonly kind: SmsProviderErrorKind
  /** HTTP status Twilio answered with, or `null` when no response arrived. */
  readonly status: number | null
  /** Twilio's own numeric error code (https://www.twilio.com/docs/api/errors), if any. */
  readonly twilioCode: number | null

  constructor(
    message: string,
    kind: SmsProviderErrorKind,
    status: number | null,
    twilioCode: number | null,
  ) {
    super(message)
    this.name = 'SmsProviderError'
    this.kind = kind
    this.status = status
    this.twilioCode = twilioCode
  }
}

const ACCOUNT_SID_SHAPE = /AC[0-9a-fA-F]{32}/g
const REDACTED = '[redacted]'

/** Node network error codes: `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `EAI_AGAIN`... */
const NETWORK_ERROR_CODE = /^E[A-Z_]+$/

function kindForStatus(status: number): SmsProviderErrorKind {
  if (status === 401 || status === 403) return 'auth'
  if (status === 400) return 'invalid-request'
  if (status === 404) return 'not-found'
  if (status === 429) return 'rate-limited'
  if (status >= 500) return 'unavailable'
  return 'unknown'
}

function redact(text: string, secrets: readonly string[]): string {
  let out = text
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join(REDACTED)
  }
  // Belt and braces for a SID that was not passed in: Twilio echoes account
  // SIDs in some error text, and one is an identifier an operator would rather
  // not see in a log aggregator.
  return out.replace(ACCOUNT_SID_SHAPE, REDACTED)
}

/**
 * Maps whatever a Twilio call threw into an {@link SmsProviderError}.
 *
 * Pure, and total: a thrown string, `undefined` or a network error with no HTTP
 * status all map to something rather than crashing the handler that is already
 * dealing with a failure.
 *
 * The message is rebuilt rather than forwarded, with `secrets` (the configured
 * account SID and auth token) and anything shaped like an account SID replaced.
 * The original error is deliberately not kept as `cause`: a logger that walks
 * the cause chain would print the unredacted message the redaction exists to
 * hide.
 */
export function mapTwilioError(err: unknown, secrets: readonly string[] = []): SmsProviderError {
  if (err instanceof SmsProviderError) return err

  const fields = (typeof err === 'object' && err !== null ? err : {}) as {
    status?: unknown
    code?: unknown
  }

  const status = typeof fields.status === 'number' ? fields.status : null
  const twilioCode = typeof fields.code === 'number' ? fields.code : null

  let kind: SmsProviderErrorKind
  if (status !== null) {
    kind = kindForStatus(status)
  } else if (typeof fields.code === 'string' && NETWORK_ERROR_CODE.test(fields.code)) {
    kind = 'unavailable'
  } else {
    kind = 'unknown'
  }

  const detail = err instanceof Error ? redact(err.message, secrets) : 'unknown error'
  const where = [
    kind,
    status !== null ? `HTTP ${status}` : null,
    twilioCode !== null ? `code ${twilioCode}` : null,
  ]
    .filter(Boolean)
    .join(', ')

  return new SmsProviderError(`Twilio request failed (${where}): ${detail}`, kind, status, twilioCode)
}
