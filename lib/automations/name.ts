/**
 * Imports nothing, so client components can share the limit with the API
 * routes without pulling server-only modules (Pino, Prisma) into the browser
 * bundle — same reason `lib/validation/inbox-policy-messages.ts` is import-free.
 */

/** Matches the inbox display-name cap. Measured after trimming. */
export const MAX_AUTOMATION_NAME_LENGTH = 100

export const AUTOMATION_NAME_TOO_LONG_MESSAGE = `name must be ${MAX_AUTOMATION_NAME_LENGTH} characters or fewer`
