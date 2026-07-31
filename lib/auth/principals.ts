/**
 * Principal shapes, split out of the old auth-context module so that
 * with-auth.ts does not import resolveAuthContext — which Task 7 deletes.
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
