import { NextRequest } from 'next/server'
import { withUser } from '@/lib/auth/with-auth'
import { getAuthenticatedUser, formatUserResponse } from '@/lib/auth-server'
import { getAppConfig } from '@/lib/config/app-config'
import { resolveOrganizationPlans } from '@/lib/commercial/org-plan'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'

/**
 * `allowUnverified` because this route is what the gate screen is built from
 * (issue #102 §7.1): it carries the address the mail went to and the
 * `emailVerificationRequired` flag the client branches on. Gating it would
 * leave an unverified user with a 403 and nothing to render.
 */
export const GET = withUser({ allowUnverified: true }, async (request: NextRequest) => {
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
  const formatted = formatUserResponse(user)

  // Plans hang off each organization rather than off `config` (issue #117 §7b):
  // a plan is tenant-scoped and `AppConfig` is deployment-scoped, so there is no
  // correct single value for a user in two organizations. `role` already sets
  // the precedent for per-organization attributes living here.
  //
  // A no-op when USE_COMMERCIAL is off — no lookup, and the field is simply
  // absent, which the client reads as "no plan restrictions".
  const plans = await resolveOrganizationPlans(formatted.organizations.map((o) => o.id))
  const organizations = formatted.organizations.map((organization) => {
    const plan = plans.get(organization.id)
    return plan ? { ...organization, plan } : organization
  })

  return jsonSuccess({ ...formatted, organizations, config: getAppConfig() })
})
