import { NextRequest } from 'next/server'
import { withUser } from '@/lib/auth/with-auth'
import { getAuthenticatedUser, formatUserResponse } from '@/lib/auth-server'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'

export const GET = withUser(async (request: NextRequest) => {
  // withUser has already verified the credential; this second lookup exists
  // only because formatUserResponse needs the organization relation that the
  // principal resolver deliberately does not load.
  const user = await getAuthenticatedUser(request)
  if (!user) return jsonError('Unauthorized', 401)

  return jsonSuccess(formatUserResponse(user))
})
