import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-server'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
import { serializeApiKey } from '../route'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const user = await getAuthenticatedUser(request)
  if (!user) return jsonError('Unauthorized', 401)

  const { id } = await params

  const key = await prisma.apiKey.findUnique({ where: { id } })
  if (!key || key.userId !== user.id || key.revokedAt) {
    return jsonError('Not found', 404)
  }

  return jsonSuccess(serializeApiKey(key))
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const user = await getAuthenticatedUser(request)
  if (!user) return jsonError('Unauthorized', 401)

  const { id } = await params

  const key = await prisma.apiKey.findUnique({ where: { id } })
  if (!key || key.userId !== user.id || key.revokedAt) {
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
}
