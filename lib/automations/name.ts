/**
 * Imports nothing, so client components can share the limit with the API
 * routes without pulling server-only modules (Pino, Prisma) into the browser
 * bundle — same reason `lib/validation/inbox-policy-messages.ts` is import-free.
 */

/** Matches the inbox display-name cap. Measured after trimming. */
export const MAX_AUTOMATION_NAME_LENGTH = 100

export const AUTOMATION_NAME_TOO_LONG_MESSAGE = `name must be ${MAX_AUTOMATION_NAME_LENGTH} characters or fewer`

const COPY_SUFFIX = ' Copy'

/** "<name> Copy", shortened at the name so the result still fits the cap. */
export function duplicateAutomationName(name: string) {
  const base = name.slice(0, MAX_AUTOMATION_NAME_LENGTH - COPY_SUFFIX.length).trimEnd()
  return `${base}${COPY_SUFFIX}`
}
