/**
 * Principal shapes, split out of the old auth-context module so that
 * with-auth.ts did not import the resolveAuthContext that used to live
 * alongside them. That module is now deleted.
 */
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
