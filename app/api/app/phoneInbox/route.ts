import { withUser } from '@/lib/auth/with-auth'
import { jsonSuccess, jsonError, jsonPlanDenial } from '@/lib/api-helpers'
import { checkResourceLimit } from '@/lib/commercial/enforce'
import logger from '@/lib/logger'
import { serializeAppPhoneInbox } from '@/lib/serializers/app/phone-inbox'
import { countLivePhoneInboxes, listPhoneInboxes } from '@/lib/services/phone-inbox'
import { NumberUnavailableError, provisionPhoneInbox } from '@/lib/services/phone-provisioning'
import { toOrgScope, toPhoneWriteScope } from '@/lib/services/scope'
import { phonePlanGate, smsEnabledGate, smsFailureResponse } from '@/lib/sms/http'
import { isNanpNumber, isSmsCountry } from '@/lib/sms/validation'

export const GET = withUser(async (request, principal) => {
  const organizationId = request.nextUrl.searchParams.get('organizationId')

  const { scope, error } = toOrgScope(principal, organizationId)
  if (error) return error

  // Organization-wide, like email inboxes. Who may *release* a number is a
  // separate, creator-only question; `isOwner` is how the UI tells them apart.
  const inboxes = await listPhoneInboxes(scope)
  return jsonSuccess(inboxes.map((inbox) => serializeAppPhoneInbox(inbox, principal.userId)))
})

export const POST = withUser(async (request, principal) => {
  let body: { organizationId?: unknown; phoneNumber?: unknown; countryCode?: unknown }
  try {
    body = await request.json()
  } catch {
    return jsonError('Request body must be valid JSON', 400)
  }

  const { organizationId, phoneNumber, countryCode } = body ?? {}
  if (typeof organizationId !== 'string' || !organizationId || !phoneNumber || !countryCode) {
    return jsonError('organizationId, phoneNumber, and countryCode are required', 400)
  }
  if (!isSmsCountry(countryCode)) {
    return jsonError('countryCode must be US or CA', 400)
  }
  if (!isNanpNumber(phoneNumber)) {
    return jsonError('phoneNumber must be a US or Canadian number in E.164 format, e.g. +14155550100', 400)
  }

  const { scope, error } = toPhoneWriteScope(principal, organizationId)
  if (error) return error

  // Two gates, and they answer different questions: `phoneInboxesEnabled` is
  // "does this plan have the feature at all", `phoneInboxes` is "how many".
  const planDenied = await phonePlanGate(organizationId)
  if (planDenied) return planDenied

  const denial = await checkResourceLimit(organizationId, 'phoneInboxes', 'phone inbox', () =>
    countLivePhoneInboxes(organizationId),
  )
  if (denial) return jsonPlanDenial(denial)

  const smsOff = smsEnabledGate()
  if (smsOff) return smsOff

  try {
    const inbox = await provisionPhoneInbox(scope, { phoneNumber, countryCode })
    return jsonSuccess(serializeAppPhoneInbox(inbox, principal.userId), 201)
  } catch (err) {
    if (err instanceof NumberUnavailableError) return jsonError(err.message, 409)
    const mapped = smsFailureResponse(err)
    if (mapped) return mapped
    logger.error({ error: err }, 'phone inbox provisioning failed')
    return jsonError('Internal server error', 500)
  }
})
