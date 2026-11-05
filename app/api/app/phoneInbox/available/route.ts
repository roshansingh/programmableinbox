import { withUser } from '@/lib/auth/with-auth'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
import logger from '@/lib/logger'
import { toOrgScope } from '@/lib/services/scope'
import { phonePlanGate, smsEnabledGate, smsFailureResponse } from '@/lib/sms/http'
import { searchAvailableNumbers } from '@/lib/sms/numbers'
import { isAreaCode, isSmsCountry } from '@/lib/sms/validation'

/**
 * Numbers Twilio can sell in an area code. Gated like a purchase — membership,
 * then plan — so inventory is not browsable by organizations that cannot buy
 * from it, and so every search is attributable to one.
 */
export const GET = withUser(async (request, principal) => {
  const query = request.nextUrl.searchParams
  const organizationId = query.get('organizationId')
  const country = query.get('country')
  const areaCode = query.get('areaCode')

  if (!organizationId) return jsonError('organizationId is required', 400)
  if (!isSmsCountry(country)) return jsonError('country must be US or CA', 400)
  if (!isAreaCode(areaCode)) return jsonError('areaCode must be exactly three digits', 400)

  const { error } = toOrgScope(principal, organizationId)
  if (error) return error

  const planDenied = await phonePlanGate(organizationId)
  if (planDenied) return planDenied

  const smsOff = smsEnabledGate()
  if (smsOff) return smsOff

  try {
    return jsonSuccess(await searchAvailableNumbers(country, areaCode))
  } catch (err) {
    const mapped = smsFailureResponse(err)
    if (mapped) return mapped
    logger.error({ error: err }, 'phone number search failed')
    return jsonError('Internal server error', 500)
  }
})
