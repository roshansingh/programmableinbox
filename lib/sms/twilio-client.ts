import twilio from 'twilio'
import { requireSms } from '@/lib/config'
import logger from '@/lib/logger'
import { mapTwilioError } from './errors'

/**
 * Lazily-constructed Twilio client.
 *
 * Built on first use, never at module load, for the same reason as
 * `lib/resend.ts`: `next build` evaluates route modules with no secrets in the
 * environment, so a module-scope construction would break the build rather than
 * the misconfigured deployment. Credentials come from `requireSms()`, which
 * throws a `ConfigError` naming the variable when SMS is off or incomplete —
 * nothing here defaults or falls back.
 *
 * Automatic retry is the SDK's own policy and covers **429 only** (with
 * backoff, up to `maxRetries`). A 5xx or a network failure is *not* retried: it
 * surfaces once as an `unavailable` `SmsProviderError`, and a caller that needs
 * a retry on those must do it itself. A 4xx is the caller's mistake and
 * retrying it only repeats it.
 *
 * Prefer {@link callTwilio}. Redaction of the account SID and auth token, and
 * dropping the original error as `cause`, only protect callers that go through
 * it — never log a raw error thrown from a client obtained directly here.
 */
let client: twilio.Twilio | null = null

export function getTwilio(): twilio.Twilio {
  if (!client) {
    const { accountSid, authToken } = requireSms()
    client = twilio(accountSid, authToken, { autoRetry: true, maxRetries: 3 })
  }
  return client
}

/** Test seam: drop the memoized client so the next `getTwilio()` rebuilds it. */
export function resetTwilioClientForTests(): void {
  client = null
}

/**
 * Runs a Twilio call and rethrows any failure as an `SmsProviderError`.
 *
 * A `ConfigError` from {@link getTwilio} is *not* wrapped: a missing credential
 * is an operator problem with its own message naming the variable, and
 * reporting it as a provider failure would hide that.
 */
export async function callTwilio<T>(fn: (client: twilio.Twilio) => Promise<T>): Promise<T> {
  const { accountSid, authToken } = requireSms()
  const twilioClient = getTwilio()

  try {
    return await fn(twilioClient)
  } catch (error) {
    const mapped = mapTwilioError(error, [accountSid, authToken])
    logger.error({ error: mapped }, 'twilio request failed')
    throw mapped
  }
}
