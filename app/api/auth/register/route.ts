import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { hashPassword, signToken, formatUserResponse } from '@/lib/auth-server'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'

export async function POST(request: NextRequest) {
  try {
    const { email, password, firstName, lastName } = await request.json()

    if (!email || !password) {
      return jsonError('Email and password are required', 400)
    }

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return jsonError('User with this email already exists', 409)
    }

    const passwordHash = await hashPassword(password)
    const slug = email.split('@')[0].toLowerCase().replace(/[^a-z0-9-]/g, '-')

    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email,
          passwordHash,
          firstName: firstName || null,
          lastName: lastName || null,
        },
      })

      const org = await tx.organization.create({
        data: {
          name: 'My Organization',
          slug: `${slug}-${Date.now()}`,
        },
      })

      await tx.membership.create({
        data: {
          userId: newUser.id,
          organizationId: org.id,
          role: 'owner',
        },
      })

      return await tx.user.findUniqueOrThrow({
        where: { id: newUser.id },
        include: {
          memberships: {
            include: { organization: true },
          },
        },
      })
    })

    const token = signToken({ userId: user.id })

    return jsonSuccess({
      token,
      user: formatUserResponse(user),
    })
  } catch {
    return jsonError('Internal server error', 500)
  }
}
