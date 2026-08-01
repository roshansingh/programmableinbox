import { NextRequest } from 'next/server'
import { withUser } from '@/lib/auth/with-auth'
import { getAuthenticatedUser, formatUserResponse } from '@/lib/auth-server'
import { getAppConfig } from '@/lib/config/app-config'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'

export const GET = withUser(async (request: NextRequest) => {
  // withUser has already verified the credential; this second lookup exists
  // only because formatUserResponse needs the organization relation that the
  // principal resolver deliberately does not load.
  const user = await getAuthenticatedUser(request)
  if (!user) return jsonError('Unauthorized', 401)

  // Client-visible platform config rides along as a sibling of the user fields
  // (issue #98). It is attached here rather than inside formatUserResponse so
  // that login and register — which nest the user under `{ user: ... }` and are
  // followed by an AuthProvider refetch of this route anyway — keep their
  // current shape.
  return jsonSuccess({ ...formatUserResponse(user), config: getAppConfig() })
})
