import { Resend } from 'resend'
import { config } from './config'

/**
 * Lazily-constructed Resend client.
 *
 * The Resend constructor is deferred to first use so that `next build`
 * (which evaluates route modules without runtime secrets) does not throw.
 * The config accessor is also lazy, so AUTH_RESEND_API_KEY is only required
 * at request time, not at build time.
 */
let client: Resend | null = null

export function getResend(): Resend {
  if (!client) {
    client = new Resend(config.email.resendApiKey.reveal())
  }
  return client
}
