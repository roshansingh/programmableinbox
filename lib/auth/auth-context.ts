import { NextRequest } from 'next/server'
import { resolveUserPrincipalFromToken } from '@/lib/auth-server'
import { resolveApiKeyPrincipal } from './api-key-auth'

export type { UserPrincipal, ApiKeyPrincipal } from './principals'

import type { UserPrincipal, ApiKeyPrincipal } from './principals'

export type AuthContext = UserPrincipal | ApiKeyPrincipal

export async function resolveAuthContext(request: NextRequest): Promise<AuthContext | null> {
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return null
  }

  const credential = authHeader.slice(7)
  const userPrincipal = await resolveUserPrincipalFromToken(credential)
  if (userPrincipal) {
    return userPrincipal
  }

  return await resolveApiKeyPrincipal(credential)
}
