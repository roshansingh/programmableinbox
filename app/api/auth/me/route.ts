import { NextRequest } from 'next/server'
import { getAuthenticatedUser, formatUserResponse } from '@/lib/auth-server'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request)
  if (!user) {
    return jsonError('Unauthorized', 401)
  }

  return jsonSuccess(formatUserResponse(user))
}
