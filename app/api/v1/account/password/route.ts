import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { resolveAuthContext } from '@/lib/auth/auth-context'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'

export async function PATCH(request: NextRequest) {
  const context = await resolveAuthContext(request)
  if (!context) return jsonError('Unauthorized', 401)
  if (context.kind !== 'user') return jsonError('Forbidden', 403)

  const body = await request.json()
  const { currentPassword, newPassword } = body

  if (!currentPassword || !newPassword) {
    return jsonError('currentPassword and newPassword are required', 400)
  }
  if (newPassword.length < 8) {
    return jsonError('New password must be at least 8 characters', 400)
  }

  const user = await prisma.user.findUnique({
    where: { id: context.userId },
    select: { id: true, passwordHash: true },
  })
  if (!user) return jsonError('User not found', 404)

  const valid = await bcrypt.compare(currentPassword, user.passwordHash)
  if (!valid) return jsonError('Current password is incorrect', 401)

  const passwordHash = await bcrypt.hash(newPassword, 10)
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } })

  return jsonSuccess({ message: 'Password updated' })
}
