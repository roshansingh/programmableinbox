import { describe, expect, it, vi } from 'vitest'
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { getHandlerTag, getHandlerTagInfo, type RouteTag } from '@/lib/auth/route-tags'

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

/**
 * The only deliberately unauthenticated handlers under app/api/app.
 *
 * `auth/verification/confirm` is here because the verification link is
 * routinely opened on a device holding no session (issue #102 §7.3) — the
 * emailed token is the credential, and it authorizes exactly one state change.
 *
 * `auth/password-reset/request` and `auth/password-reset/confirm` are here
 * for the same reason: their caller cannot be authenticated — that is the
 * entire premise of a password reset — so a session-based wrapper would be a
 * contradiction. `confirm` is authenticated by the purpose-scoped token in its
 * body; `request` is genuinely unauthenticated, and is safe because the link
 * it sends goes only to the address's own mailbox and its response is
 * identical for every outcome.
 */
const PUBLIC_APP_ROUTES = [
  'auth/login',
  'auth/register',
  'auth/verification/confirm',
  'auth/password-reset/request',
  'auth/password-reset/confirm',
]

/**
 * The exact set of `withUser` routes exempt from the email-verification gate
 * (issue #102 §7.1). A fourth route quietly opting out fails guard 7.
 *
 * Paths are relative to the repo root, matching what `findRouteFiles` returns,
 * so this list is greppable against the tree rather than a substring guess.
 */
const VERIFICATION_OPT_OUTS = [
  // The gate screen cannot render without the user and the config.
  'app/api/app/auth/me/route.ts',
  // Only an unverified user ever calls it; gating it would 403 the one call
  // that clears the gate.
  'app/api/app/auth/verification/resend/route.ts',
]

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

  it('guard 3: every handler under app/api/app is withUser, except auth/login, auth/register and verification/confirm', async () => {
    await assertTree('app/api/app', (file) =>
      PUBLIC_APP_ROUTES.some((route) => file.includes(route)) ? 'public' : 'user',
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

  /**
   * The email-verification opt-out is an escape hatch from a security control,
   * so its membership is pinned rather than left to review. The flag is read
   * off the symbol the wrapper attaches — a route cannot claim the opt-out in
   * a comment, only by actually calling `withUser({ allowUnverified: true })`.
   */
  it('guard 7: exactly the allowlisted withUser routes opt out of email verification', async () => {
    const optedOut: string[] = []

    for (const file of findRouteFiles('app/api/app')) {
      const mod = (await import(path.join(REPO_ROOT, file))) as Record<string, unknown>
      for (const method of HTTP_METHODS) {
        const info = getHandlerTagInfo(mod[method])
        if (info?.tag === 'user' && info.allowUnverified) optedOut.push(file)
      }
    }

    expect([...new Set(optedOut)].sort()).toEqual([...VERIFICATION_OPT_OUTS].sort())
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
