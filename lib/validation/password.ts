/**
 * The one definition of "a valid password", shared by registration and reset.
 *
 * Imports nothing, so the client can render the same messages the server
 * enforces without pulling Pino into the browser bundle — the pattern
 * `lib/validation/inbox-policy-messages.ts` established.
 */

export const PASSWORD_MIN_LENGTH = 8

/**
 * bcrypt silently truncates at 72 *bytes*. Above that, two different passwords
 * sharing a 72-byte prefix are the same password, and the extra characters give
 * a false sense of strength. Rejecting is honest; truncating is not.
 */
export const PASSWORD_MAX_LENGTH = 72

export const PASSWORD_TOO_SHORT = `Password must be at least ${PASSWORD_MIN_LENGTH} characters`
export const PASSWORD_TOO_LONG = `Password must be at most ${PASSWORD_MAX_LENGTH} bytes`

/**
 * Returns the message to show, or null when the password is acceptable.
 *
 * A non-string collapses to TOO_SHORT rather than getting its own message: the
 * caller is a JSON body of unknown shape, and "you sent a number" is not
 * something a user can act on.
 *
 * Deliberately does not trim. A leading or trailing space is a legitimate part
 * of a password, and trimming it here would mean a password that registers
 * cannot be used to log in.
 */
export function validatePassword(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < PASSWORD_MIN_LENGTH) {
    return PASSWORD_TOO_SHORT
  }

  // TextEncoder rather than Buffer.byteLength: this module's doc comment
  // promises no dependencies so a client component can import it directly
  // (app/auth/reset-password/page.tsx does), and Buffer is a Node global that
  // only works in the browser via Next's polyfill — which jsdom would hide a
  // regression in, since jsdom itself provides a real Buffer too.
  if (new TextEncoder().encode(value).length > PASSWORD_MAX_LENGTH) {
    return PASSWORD_TOO_LONG
  }

  return null
}
