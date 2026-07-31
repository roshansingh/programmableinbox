import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { withUser } from '@/lib/auth/with-auth'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withUser<{ id: string }>(async (request, principal, { params }) => {

  const { id } = await params

  const inbox = await prisma.phoneInbox.findUnique({ where: { id } })
  if (!inbox || inbox.userId !== principal.userId) {
    return jsonError('Not found', 404)
  }

  return jsonSuccess(inbox)
})

export const PATCH = withUser<{ id: string }>(async (request, principal, { params }) => {

  const { id } = await params

  const inbox = await prisma.phoneInbox.findUnique({ where: { id } })
  if (!inbox || inbox.userId !== principal.userId) {
    return jsonError('Not found', 404)
  }

  try {
    const { phoneNumber, countryCode } = await request.json()

    const updated = await prisma.phoneInbox.update({
      where: { id },
      data: {
        ...(phoneNumber !== undefined && { phoneNumber }),
        ...(countryCode !== undefined && { countryCode }),
      },
    })

    return jsonSuccess(updated)
  } catch {
    return jsonError('Internal server error', 500)
  }
})

export const DELETE = withUser<{ id: string }>(async (request, principal, { params }) => {

  const { id } = await params

  const inbox = await prisma.phoneInbox.findUnique({ where: { id } })
  if (!inbox || inbox.userId !== principal.userId) {
    return jsonError('Not found', 404)
  }

  // Soft delete (F8).
  await prisma.phoneInbox.update({ where: { id }, data: { deletedAt: new Date() } })

  return new Response(null, { status: 204 })
})
