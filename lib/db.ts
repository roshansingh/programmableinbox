import { PrismaClient } from './generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { config } from './config'
import { applySoftDeleteFilter, isSoftDeleteFiltered } from './db-soft-delete'

function createPrismaClient() {
  // `config.db.url` is a validated string, never `undefined` — the adapter used
  // to accept `process.env.DATABASE_URL` unset and fail later, at query time.
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

const globalForPrisma = globalThis as unknown as { prisma?: ExtendedPrismaClient }

/**
 * Returns the shared client, creating it on first use.
 *
 * Deliberately lazy. The client used to be built at module load, which was
 * survivable only because the adapter accepted `connectionString: undefined`
 * and failed later, at query time. Now that the URL is validated, building at
 * module load would throw during `next build` — which evaluates every route
 * module with no environment — and in any unit test that transitively imports
 * this module without touching the database.
 *
 * The dev-only `globalThis` cache is unchanged: it survives hot reload so a
 * reloading dev server does not exhaust the connection pool.
 */
function getPrismaClient(): ExtendedPrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma

  const client = createPrismaClient()
  if (!config.runtime.isProduction) globalForPrisma.prisma = client
  return client
}

let _instance: ExtendedPrismaClient | undefined

/**
 * The shared Prisma client.
 *
 * A Proxy over the lazy singleton, mirroring `lib/logger.ts`, so call sites
 * keep writing `prisma.user.findUnique(...)` while construction is deferred to
 * the first property access.
 */
export const prisma = new Proxy({} as ExtendedPrismaClient, {
  get(_target, prop, receiver) {
    _instance ??= getPrismaClient()
    return Reflect.get(_instance as object, prop, receiver)
  },
  has(_target, prop) {
    _instance ??= getPrismaClient()
    return Reflect.has(_instance as object, prop)
  },
})
