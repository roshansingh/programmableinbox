import { PrismaClient } from './generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { applySoftDeleteFilter, isSoftDeleteFiltered } from './db-soft-delete'

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })

  // Soft delete (F8): every read of a soft-deletable model gets `deletedAt:
  // null` injected here, so no call site can forget it.
  // See lib/db-soft-delete.ts for what is and isn't covered.
  return new PrismaClient({ adapter }).$extends({
    name: 'softDelete',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (!isSoftDeleteFiltered(model, operation)) {
            return query(args)
          }
          return query(applySoftDeleteFilter(args as { where?: Record<string, unknown> }))
        },
      },
    },
  })
}

type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>

const globalForPrisma = globalThis as unknown as { prisma: ExtendedPrismaClient }

export const prisma = globalForPrisma.prisma || createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
