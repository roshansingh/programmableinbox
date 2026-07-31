import { describe, expect, it, vi } from 'vitest'
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { getHandlerTag, type RouteTag } from '@/lib/auth/route-tags'

/**
 * Importing a route module runs its top-level imports, which reach Prisma.
 * Stub the client so the guards never need a database.
 */
vi.mock('@/lib/db', () => ({ prisma: new Proxy({}, { get: () => () => {} }) }))

const REPO_ROOT = path.resolve(__dirname, '../..')
const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const

function findRouteFiles(dir: string): string[] {
  const absolute = path.join(REPO_ROOT, dir)
  let entries: string[]
  try {
    entries = readdirSync(absolute)
  } catch {
    return [] // tree does not exist yet
  }

  return entries.flatMap((entry) => {
    const full = path.join(absolute, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') return []
      return findRouteFiles(path.join(dir, entry))
    }
    return entry === 'route.ts' ? [path.join(dir, entry)] : []
  })
}

async function handlersIn(routeFile: string) {
  const mod = (await import(path.join(REPO_ROOT, routeFile))) as Record<string, unknown>
  return HTTP_METHODS.filter((method) => typeof mod[method] === 'function').map((method) => ({
    method,
    tag: getHandlerTag(mod[method]),
  }))
}

async function assertTree(dir: string, expected: (file: string, method: string) => RouteTag) {
  const files = findRouteFiles(dir)
  const violations: string[] = []

  for (const file of files) {
    for (const { method, tag } of await handlersIn(file)) {
      const want = expected(file, method)
      if (tag !== want) {
        violations.push(`${file} ${method}: expected "${want}" tag, got ${tag ?? 'no tag'}`)
      }
    }
  }

  expect(violations).toEqual([])
}

describe('structural route guards', () => {
  it('guard 1: no mutating handler exists anywhere under app/api/v1', async () => {
    const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE']
    const offenders: string[] = []

    for (const file of findRouteFiles('app/api/v1')) {
      const mod = (await import(path.join(REPO_ROOT, file))) as Record<string, unknown>
      for (const method of MUTATING) {
        if (typeof mod[method] === 'function') offenders.push(`${file} ${method}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('guard 2: every handler under app/api/v1 is wrapped with withApiKey', async () => {
    await assertTree('app/api/v1', () => 'apiKey')
  })

  it('guard 3: every handler under app/api/app is withUser, except auth/login and auth/register', async () => {
    await assertTree('app/api/app', (file) =>
      file.includes('auth/login') || file.includes('auth/register') ? 'public' : 'user',
    )
  })

  it('guard 4: every handler under app/api/webhooks is withPublic', async () => {
    await assertTree('app/api/webhooks', () => 'public')
  })

  it('guard 5: no handler in app/api/v1, app/api/app or app/api/webhooks is untagged', async () => {
    const files = [
      ...findRouteFiles('app/api/v1'),
      ...findRouteFiles('app/api/app'),
      ...findRouteFiles('app/api/webhooks'),
    ]

    const untagged: string[] = []
    for (const file of files) {
      for (const { method, tag } of await handlersIn(file)) {
        if (tag === null) untagged.push(`${file} ${method}`)
      }
    }

    expect(untagged).toEqual([])
  })

  it('guard 6: every documented OpenAPI path is under /api/v1', async () => {
    // The module exports `spec`, not `emailInboxesSpec`.
    const { spec } = await import('@/lib/openapi/email-inboxes')
    const paths = Object.keys((spec as { paths: Record<string, unknown> }).paths)

    expect(paths.length).toBeGreaterThan(0)
    for (const p of paths) {
      expect(p.startsWith('/api/v1')).toBe(true)
    }
  })
})
