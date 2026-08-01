import { PrismaClient } from './generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { applySoftDeleteFilter, isSoftDeleteFiltered } from './db-soft-delete'
import { config } from './config'

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: config.db.url })

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

/**
 * Lazily creates and caches the Prisma client. The lazy pattern is required
 * because `next build` evaluates this module without DATABASE_URL set, and
 * config.db.url would throw if evaluated at module-load time.
 * The client is created on first access (first DB call at runtime).
 */
function getOrCreatePrisma(): ExtendedPrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient()
  }
  return globalForPrisma.prisma
}

/**
 * The global Prisma client. Exported as a Proxy so creation (and config
 * validation) is deferred until the first database call, not at module load.
 */
export const prisma: ExtendedPrismaClient = new Proxy({} as ExtendedPrismaClient, {
  get(_target, prop) {
    return Reflect.get(getOrCreatePrisma(), prop)
  },
})
