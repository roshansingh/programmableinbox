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
  /**
   * The user who minted the key.
   *
   * Present so that an inbox created through `email_inboxes:create` has an
   * owner — `EmailInbox.userId` is NOT NULL, and it is also what scopes a
   * key's updates and deletes to rows it is responsible for. It is deliberately
   * NOT enough to make a key into a user: `toOwnerScope` still accepts only a
   * `UserPrincipal`, so carrying a userId here does not put `deleteMessage` or
   * `setMessageStarred` within reach. See `lib/services/scope.ts`.
   */
  userId: string
  scopes: string[]
}
