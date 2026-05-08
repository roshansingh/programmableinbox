import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyPassword, signToken, formatUserResponse } from '@/lib/auth-server'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json()

    if (!email || !password) {
      return jsonError('Email and password are required', 400)
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        memberships: {
          include: { organization: true },
        },
      },
    })

    if (!user) {
      return jsonError('Invalid email or password', 401)
    }

    const valid = await verifyPassword(password, user.passwordHash)
    if (!valid) {
      return jsonError('Invalid email or password', 401)
    }

    const token = signToken({ userId: user.id })

    return jsonSuccess({
      token,
      user: formatUserResponse(user),
    })
  } catch {
    return jsonError('Internal server error', 500)
  }
}
