import { Resend } from 'resend'

/**
 * Lazily-constructed Resend client.
 *
 * The Resend constructor throws when `AUTH_RESEND_API_KEY` is absent. Building
 * the client at module load breaks `next build`, which evaluates route modules
 * without runtime secrets present. Deferring construction to first use means the
 * key is only required at request time, not at build time.
 */
let client: Resend | null = null

export function getResend(): Resend {
  if (!client) {
    client = new Resend(process.env.AUTH_RESEND_API_KEY)
  }
  return client
}
