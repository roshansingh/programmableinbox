/**
 * Tests for lib/auth/public-routes.ts
 *
 * The filesystem test below is the point of the file. `/auth/forgot-password`
 * and `/auth/reset-password` shipped without being added to any of the three
 * copies of this list that existed at the time, and nothing failed: the pages
 * rendered, the guard redirected, and the only user who would ever visit them
 * was sent to the page they had already established they could not get past.
 * Consolidating the list removes the drift between copies; only this test
 * notices when a *new* page is added to none of them.
 */

import { describe, expect, it } from 'vitest'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  PUBLIC_ROUTES,
  SESSION_FETCH_SKIPPED_ROUTES,
  isPublicPath,
} from '../public-routes'

/**
 * Pages under `app/auth/` that deliberately require a session.
 *
 * Empty today. An entry here is a claim that the page is unreachable without
 * logging in first, which for something under `/auth/` needs a reason.
 */
const AUTH_PAGES_REQUIRING_SESSION: string[] = []

describe('PUBLIC_ROUTES', () => {
  it('covers every page under app/auth/', () => {
    const pages = readdirSync(join(process.cwd(), 'app', 'auth'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `/auth/${entry.name}`)

    // Guards the guard: if the directory scan ever silently returns nothing,
    // this test would pass while asserting about an empty set.
    expect(pages.length).toBeGreaterThan(0)

    const uncovered = pages.filter(
      (page) => !isPublicPath(page) && !AUTH_PAGES_REQUIRING_SESSION.includes(page),
    )

    expect(uncovered).toEqual([])
  })

  it('excludes only /auth/verify from the session fetch', () => {
    const difference = PUBLIC_ROUTES.filter(
      (route) => !SESSION_FETCH_SKIPPED_ROUTES.includes(route),
    )

    expect(difference).toEqual(['/auth/verify'])
  })
})

describe('isPublicPath', () => {
  it('matches a route exactly', () => {
    expect(isPublicPath('/auth/login')).toBe(true)
  })

  it('matches paths beneath a route', () => {
    expect(isPublicPath('/auth/verify/resend')).toBe(true)
  })

  it('does not match a path that merely shares a stem', () => {
    // The `+ '/'` in the matcher is what makes this false. Without it, any
    // route whose name starts with a public one inherits its exemption.
    expect(isPublicPath('/auth/login-as-someone-else')).toBe(false)
    expect(isPublicPath('/api-docs-internal')).toBe(false)
  })

  it('does not match a protected page', () => {
    expect(isPublicPath('/emails')).toBe(false)
    expect(isPublicPath('/')).toBe(false)
  })

  it('matches against a caller-supplied list', () => {
    expect(isPublicPath('/auth/verify', SESSION_FETCH_SKIPPED_ROUTES)).toBe(false)
    expect(isPublicPath('/auth/login', SESSION_FETCH_SKIPPED_ROUTES)).toBe(true)
  })
})
