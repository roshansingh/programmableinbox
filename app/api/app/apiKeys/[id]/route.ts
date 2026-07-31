import { prisma } from '@/lib/db'
import { withUser } from '@/lib/auth/with-auth'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
import { serializeApiKey } from '../route'

/**
 * Scoped by `userId`, not by organization. API keys are user-created
 * credentials and the split does not change their visibility model — a
 * colleague cannot see or revoke a key you issued.
 */
export const GET = withUser<{ id: string }>(async (_request, principal, { params }) => {
  const { id } = await params

  const key = await prisma.apiKey.findUnique({ where: { id } })
  if (!key || key.userId !== principal.userId || key.revokedAt) {
    return jsonError('Not found', 404)
  }

  return jsonSuccess(serializeApiKey(key))
})

export const DELETE = withUser<{ id: string }>(async (_request, principal, { params }) => {
  const { id } = await params

  const key = await prisma.apiKey.findUnique({ where: { id } })
  if (!key || key.userId !== principal.userId || key.revokedAt) {
    return jsonError('Not found', 404)
  }

  // Revoke rather than delete (F5). Auth rejects revoked keys, so this takes
  // effect immediately, and the row survives as an audit trail of a key that
  // existed and was killed — which a hard delete destroys.
  await prisma.apiKey.update({
    where: { id },
    data: { revokedAt: new Date() },
  })

  return new Response(null, { status: 204 })
})
