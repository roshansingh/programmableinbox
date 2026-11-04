import 'server-only'
import { jsonError, jsonPlanDenial } from '@/lib/api-helpers'
import { CommercialProvider } from '@/lib/commercial/provider'
import { ConfigError, requireSms } from '@/lib/config'
import { SmsProviderError } from './errors'

const SMS_DISABLED = 'SMS is not enabled on this deployment'

/**
 * Null when SMS is on; a 503 naming the problem when it is off or incomplete.
 *
 * Checked by the route as well as by the Twilio client because the client is
 * only reached after a database write, and an operator who left SMS off should
 * get a corrective answer rather than a reserved-then-failed row.
 */
export function smsEnabledGate(): Response | null {
  try {
    requireSms()
    return null
  } catch (error) {
    if (error instanceof ConfigError) return jsonError(SMS_DISABLED, 503)
    throw error
  }
}

/**
 * Null when the organization's plan includes phone inboxes; a 402 otherwise.
 * Shared by the number search and the purchase so browsing inventory is gated
 * exactly like buying from it.
 */
export async function phonePlanGate(organizationId: string): Promise<Response | null> {
  const plan = await CommercialProvider.plans.resolve(organizationId)
  if (plan.limits.phoneInboxesEnabled) return null

  return jsonPlanDenial({
    message: `Phone inboxes are not included in your ${plan.planName} plan.`,
    status: 402,
    limit: 0,
    used: 0,
    planCode: plan.planCode,
  })
}

/**
 * Turns a failure from the SMS layer into the response a client should see, or
 * null when the error is not one this layer owns (the caller then 500s).
 *
 * Provider detail is never echoed: it can name accounts and credentials, and the
 * caller can do nothing with it. `callTwilio` has already logged the redacted
 * original.
 */
export function smsFailureResponse(error: unknown): Response | null {
  if (error instanceof ConfigError) return jsonError(SMS_DISABLED, 503)
  if (error instanceof SmsProviderError) {
    if (error.kind === 'rate-limited' || error.kind === 'unavailable') {
      return jsonError('Phone provider is unavailable, try again', 503)
    }
    return jsonError('Phone provider error', 502)
  }
  return null
}
