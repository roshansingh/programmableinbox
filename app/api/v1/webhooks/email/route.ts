/**
 * Temporary compatibility alias. The Resend dashboard still points here until
 * the configuration is updated to POST /api/webhooks/email. Deleted in PR 0b.
 *
 * Named re-export only: `export *` breaks the generated route-export validator,
 * and route segment config cannot be re-exported at all (build-time AST analysis
 * only matches a literal `export const X` in the route file itself).
 *
 * This alias covers the inbound HTTP URL and nothing else. The module's other
 * export, `storeIncomingEmail`, is deliberately not re-exported — internal
 * callers (lib/webhooks/worker.ts) import it from the canonical path.
 */
export { POST } from '@/app/api/webhooks/email/route'
