// test/integration/helpers/request.ts
import { NextRequest } from 'next/server'

interface Opts {
  method?: string
  body?: unknown
  credential?: string
  headers?: Record<string, string>
}

export function jsonRequest(url: string, opts: Opts = {}): NextRequest {
  const headers = new Headers(opts.headers ?? {})
  if (opts.credential) headers.set('authorization', `Bearer ${opts.credential}`)
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
