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
  if (!key || key.userId !== user.id) {
    return jsonError('Not found', 404)
  }

  return jsonSuccess(serializeApiKey(key))
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const user = await getAuthenticatedUser(request)
  if (!user) return jsonError('Unauthorized', 401)

  const { id } = await params

  const key = await prisma.apiKey.findUnique({ where: { id } })
  if (!key || key.userId !== user.id) {
    return jsonError('Not found', 404)
  }

  await prisma.apiKey.delete({ where: { id } })

  return new Response(null, { status: 204 })
}
