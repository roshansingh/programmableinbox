import { withUser } from '@/lib/auth/with-auth'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
import logger from '@/lib/logger'
import { serializeAppPhoneInbox } from '@/lib/serializers/app/phone-inbox'
import { getPhoneInbox } from '@/lib/services/phone-inbox'
import { releasePhoneInbox } from '@/lib/services/phone-provisioning'
import { toOrgScope, toOwnerScope } from '@/lib/services/scope'
import { smsFailureResponse } from '@/lib/sms/http'

// There is deliberately no PATCH: a purchased number is immutable, and a phone
// inbox has no other editable field.

export const GET = withUser<{ id: string }>(async (_request, principal, { params }) => {
  const { id } = await params

  const { scope, error } = toOrgScope(principal)
  if (error) return error

  // Another organization's inbox is a 404 rather than a 403: whether an id
  // exists elsewhere is not something this caller is entitled to learn.
  const inbox = await getPhoneInbox(scope, id)
  if (!inbox) return jsonError('Not found', 404)

  return jsonSuccess(serializeAppPhoneInbox(inbox, principal.userId))
})

export const DELETE = withUser<{ id: string }>(async (_request, principal, { params }) => {
  const { id } = await params

  try {
    // Releases the number at Twilio, which stops the monthly charge, and cannot
    // be undone: the number goes back into the pool and anyone may buy it.
    const outcome = await releasePhoneInbox(toOwnerScope(principal), id)
    if (outcome === 'not-found') return jsonError('Not found', 404)
    return new Response(null, { status: 204 })
  } catch (err) {
    const mapped = smsFailureResponse(err)
    if (mapped) return mapped
    logger.error({ error: err }, 'phone inbox release failed')
    return jsonError('Internal server error', 500)
  }
})
