// test/integration/helpers/request.ts
import { NextRequest } from 'next/server'
import { API_KEY_PREFIX } from '@/lib/api-key-scopes'
import { SESSION_COOKIE_NAME } from '@/lib/auth-server'

interface Opts {
  method?: string
  body?: unknown
  credential?: string
  headers?: Record<string, string>
}

/**
 * `credential` carries either a session JWT (dashboard routes, `withUser`)
 * or an `sk_live_` API key (`withApiKey`) — the same distinction production
 * code makes by prefix before verification. A session credential goes in
 * the cookie `withUser` now reads exclusively; an API key still goes in the
 * `Authorization` header, since that credential type was untouched by the
 * httpOnly-cookie migration.
 */
export function jsonRequest(url: string, opts: Opts = {}): NextRequest {
  const headers = new Headers(opts.headers ?? {})
  if (opts.credential) {
    if (opts.credential.startsWith(API_KEY_PREFIX)) {
      headers.set('authorization', `Bearer ${opts.credential}`)
    } else {
      headers.set('cookie', `${SESSION_COOKIE_NAME}=${opts.credential}`)
    }
  }
  if (opts.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }
  return new NextRequest(url, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
}

export function params<T extends Record<string, string>>(obj: T): { params: Promise<T> } {
  return { params: Promise.resolve(obj) }
}
