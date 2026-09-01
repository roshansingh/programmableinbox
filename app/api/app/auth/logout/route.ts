import { withUser } from '@/lib/auth/with-auth'
import { clearSessionCookie } from '@/lib/auth-server'
import { jsonSuccess } from '@/lib/api-helpers'

/**
 * `allowUnverified` because an unverified user must still be able to end
 * their own session — gating this route would leave them stuck signed in
 * with no way to clear the cookie.
 */
export const POST = withUser({ allowUnverified: true }, async () => {
  const response = jsonSuccess({ loggedOut: true })
  clearSessionCookie(response)
  return response
})
