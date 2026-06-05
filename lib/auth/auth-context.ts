import { NextRequest } from 'next/server'
import { resolveUserPrincipalFromToken } from '@/lib/auth-server'
import { resolveApiKeyPrincipal } from './api-key-auth'

export type UserPrincipal = {
  kind: 'user'
  userId: string
  email: string
  memberships: Array<{ organizationId: string; role: string }>
}

export type ApiKeyPrincipal = {
  kind: 'apiKey'
  apiKeyId: string
  organizationId: string
  scopes: string[]
}

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
