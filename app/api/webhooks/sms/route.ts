import { NextRequest, NextResponse } from 'next/server'
import { withPublic } from '@/lib/auth/with-auth'
import { ConfigError, requireSms } from '@/lib/config'
import logger from '@/lib/logger'
import { storeIncomingSms } from '@/lib/services/phone-ingest'
import { parseInboundSms, smsWebhookUrl, verifyTwilioSignature } from '@/lib/sms/webhook'

/** Far above any real Twilio delivery (a few hundred bytes to a few KB). */
const MAX_REQUEST_BYTES = 64 * 1024

/**
 * Empty TwiML: "received, do nothing". Receive-only means this route never
 * replies, and a reply here would be an outbound SMS we neither bill for nor
 * rate-limit.
 */
function emptyTwiml(): NextResponse {
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}

/**
 * Inbound SMS from Twilio (issue #142).
 *
 * Unauthenticated by design: Twilio has no bearer credential to present, so the
 * handler authenticates the *request* instead, by `X-Twilio-Signature` over the
 * configured webhook URL (`lib/sms/webhook.ts`). `withPublic` carries no behavior;
 * it marks the intent so the structural guards can tell "deliberately open" from
 * "someone forgot the wrapper".
 *
 * Anything a retry cannot fix — an unknown number, a full quota, a duplicate —
 * answers 200. A failure a retry could fix (the database) answers 500, which
 * allows a redelivery but does not promise one: whether Twilio retries a 5xx on an
 * SMS webhook is configuration-dependent and unverified.
 */
export const POST = withPublic(async (request: NextRequest) => {
  let appBaseUrl: string
  try {
    appBaseUrl = requireSms().appBaseUrl
  } catch (error) {
    if (error instanceof ConfigError) {
      logger.warn({ error }, 'Inbound SMS received while SMS is not configured')
      return NextResponse.json({ message: 'SMS is not enabled' }, { status: 503 })
    }
    throw error
  }

  // Checked before the body is read: this route is public, and the body is
  // buffered and parsed before the signature can be verified. A real delivery is
  // a few hundred bytes; the cap is generous and exists only to refuse a flood.
  const declaredLength = Number(request.headers.get('content-length') ?? 0)
  if (declaredLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ message: 'Payload too large' }, { status: 413 })
  }

  // Parsed from the raw body: the signature covers the decoded params, and
  // Twilio sends them form-encoded. A repeated key keeps its last value, which
  // can only make verification fail, never pass.
  const params = Object.fromEntries(new URLSearchParams(await request.text()))

  if (!verifyTwilioSignature(request.headers.get('x-twilio-signature'), params)) {
    // Twilio signs the URL stored on the number at purchase. If APP_BASE_URL has
    // changed since, every number fails here at once; naming the URL we checked
    // against is what makes that findable.
    logger.warn(
      { messageSid: params.MessageSid, expectedUrl: smsWebhookUrl(appBaseUrl) },
      'Invalid Twilio signature',
    )
    return NextResponse.json({ message: 'Invalid signature' }, { status: 401 })
  }

  const message = parseInboundSms(params)
  if (!message) {
    return NextResponse.json({ message: 'Missing MessageSid, From or To' }, { status: 400 })
  }

  try {
    await storeIncomingSms(message)
  } catch (error) {
    // The service logs a failed insert, but a failure before it (the lookup, the
    // plan, the quota) escapes unlogged; without this an outage is a bare 500.
    logger.error({ error, messageSid: message.externalId }, 'Failed to process inbound SMS')
    return NextResponse.json({ message: 'Webhook processing failed' }, { status: 500 })
  }

  return emptyTwiml()
})
