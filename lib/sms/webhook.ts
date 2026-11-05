import twilio from 'twilio'
import { requireSms } from '@/lib/config'

/** Where Twilio posts inbound SMS. Set per number at purchase; checked here on receipt. */
const WEBHOOK_PATH = '/api/webhooks/sms'

/**
 * Longest body kept. A concatenated SMS is at most 1600 characters; this leaves
 * room for MMS captions. Longer input is truncated, never rejected: a message we
 * refuse to store is a one-time code a person never sees.
 */
export const MAX_BODY_LENGTH = 4000

/**
 * The exact URL Twilio signs. Built from operator configuration, never from the
 * request: with `Host` or `X-Forwarded-Host` in the string, whoever controls those
 * headers also chooses what the signature is checked against. Trailing slashes are
 * trimmed so `https://x.test/` does not become `https://x.test//api/...`, which
 * would sign differently from the URL the number was bought with.
 */
export function smsWebhookUrl(appBaseUrl: string): string {
  return `${appBaseUrl.replace(/\/+$/, '')}${WEBHOOK_PATH}`
}

/**
 * Whether `header` (`X-Twilio-Signature`) is the HMAC-SHA1 of the configured URL
 * plus the sorted POST params under the account auth token. The comparison is the
 * SDK's constant-time one. Anything that is not a valid signature — a missing
 * header, a malformed value — is simply `false`.
 */
export function verifyTwilioSignature(header: string | null, params: Record<string, string>): boolean {
  if (!header) return false
  const { authToken, appBaseUrl } = requireSms()
  try {
    return twilio.validateRequest(authToken, header, smsWebhookUrl(appBaseUrl), params)
  } catch {
    return false
  }
}

export type ParsedInboundSms = {
  externalId: string
  from: string
  to: string
  body: string
  mediaCount: number
}

function nonNegativeInt(value: string | undefined): number {
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : 0
}

/**
 * Postgres rejects U+0000 in `text`, which would turn one odd message into a 500.
 * Applied to every stored field, not just the body: Twilio signs these values, so
 * a NUL elsewhere is unlikely, but the cost of being wrong is a refused message.
 */
function stripNul(value: string | undefined): string {
  return (value ?? '').replace(/\u0000/g, '')
}

function cleanBody(raw: string | undefined): string {
  let body = stripNul(raw)
  if (body.length > MAX_BODY_LENGTH) {
    body = body.slice(0, MAX_BODY_LENGTH)
    // Do not leave half of a surrogate pair at the cut.
    if (/[\uD800-\uDBFF]$/.test(body)) body = body.slice(0, -1)
  }
  return body
}

/**
 * Twilio's form params, reduced to what we store.
 *
 * `From` is kept exactly as presented and is not required to be E.164: one-time
 * codes mostly arrive from short codes (`32665`) and alphanumeric senders, which
 * are the messages this product exists to read. Media is dropped; only the count
 * survives. `null` means the request lacks what identifies a message at all.
 */
export function parseInboundSms(params: Record<string, string>): ParsedInboundSms | null {
  const externalId = stripNul(params.MessageSid).trim()
  const from = stripNul(params.From).trim()
  const to = stripNul(params.To).trim()
  if (!externalId || !from || !to) return null

  return {
    externalId,
    from,
    to,
    body: cleanBody(params.Body),
    mediaCount: nonNegativeInt(params.NumMedia),
  }
}
