/**
 * Principal shapes, split out of the old auth-context module so that
 * with-auth.ts did not import the resolveAuthContext that used to live
 * alongside them. That module is now deleted.
 */
export type UserPrincipal = {
  kind: 'user'
  userId: string
  email: string
  /**
   * Whether this user has proven control of `email` (issue #102). Always
   * populated; only consulted by `withUser` when
   * `config.emailVerification.enabled` is true.
   */
  emailVerified: boolean
  memberships: Array<{ organizationId: string; role: string }>
}

export type ApiKeyPrincipal = {
  kind: 'apiKey'
  apiKeyId: string
  organizationId: string
  scopes: string[]
}
