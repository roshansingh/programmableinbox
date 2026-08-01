/**
 * Server-side SSRF guard for outbound HTTP requests whose URL is controlled by
 * a tenant (today: the `send_webhook` automation action).
 *
 * The guard does four things:
 *
 *   1. **Shape validation** — scheme allowlist, no embedded credentials,
 *      hostname blocklist, optional egress allowlist, literal-IP blocklist.
 *      (See `./ssrf-rules`, which is pure and exhaustively unit-tested.)
 *   2. **Resolve-then-validate** — the hostname is resolved here, and *every*
 *      returned address must pass the blocklist. A name that resolves to a mix
 *      of public and private addresses is rejected outright.
 *   3. **Address pinning** — the request is issued through `node:http(s)` with
 *      a custom `lookup` that returns the address we already validated, so the
 *      socket cannot end up somewhere else. This is what closes the DNS
 *      rebinding window; `fetch`/undici gives no supported hook for it without
 *      pulling in a new dependency.
 *   4. **Manual redirect handling** — `fetch` follows redirects transparently,
 *      which means a public URL can bounce to `http://169.254.169.254/`. Every
 *      hop is re-validated from scratch, and credentials-bearing headers are
 *      dropped on a cross-origin hop.
 *
 * The response **body is never read**. Callers only get the status line. This
 * is deliberate: the automation run record is readable by the tenant, so
 * persisting an upstream body turns any SSRF into a data-exfiltration channel.
 */

import http from 'node:http'
import https from 'node:https'
import type { LookupAddress } from 'node:dns'
import { lookup as dnsLookup } from 'node:dns/promises'
import {
  SsrfBlockedError,
  assertUrlShapeAllowed,
  classifyIpAddress,
  isIpLiteral,
  parseIPv4,
  stripIpv6Brackets,
} from './ssrf-rules'
import { config } from '@/lib/config'

export {
  SsrfBlockedError,
  classifyIpAddress,
  isBlockedIpAddress,
  classifyHostname,
  assertUrlShapeAllowed,
} from './ssrf-rules'
export type { SsrfBlockReason } from './ssrf-rules'

/** Per-hop connect+response timeout. */
const DEFAULT_TIMEOUT_MS = 10_000
/** Redirect hops we are willing to follow; beyond this the 3xx is returned as-is. */
const DEFAULT_MAX_REDIRECTS = 3

export type SsrfGuardOptions = {
  /** Overrides `WEBHOOK_EGRESS_ALLOWLIST`. `null` disables the allowlist. */
  allowlist?: readonly string[] | null
  /** Overrides the `WEBHOOK_ALLOW_PRIVATE_NETWORK` dev escape hatch. */
  allowPrivateNetwork?: boolean
  /** Per-hop timeout in milliseconds. */
  timeoutMs?: number
  /** Maximum redirect hops to follow. */
  maxRedirects?: number
  /** Injection seam for tests — defaults to `dns.promises.lookup`. */
  resolver?: (hostname: string) => Promise<LookupAddress[]>
}

/** What a guarded request reports back. Never includes the response body. */
export type SafeFetchResult = {
  ok: boolean
  status: number
  statusText: string
  /** The URL of the final hop (redirect targets are already validated). */
  finalUrl: string
  /** Number of redirects followed. */
  redirects: number
}

export type SafeFetchInit = {
  method?: string
  headers?: Record<string, string>
  body?: string
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Optional egress allowlist from `WEBHOOK_EGRESS_ALLOWLIST` (comma separated).
 * Entries match exactly, or as a domain suffix when written with a leading dot
 * (`.example.com`). When unset every public host is permitted.
 */
export function readEgressAllowlist(): string[] | null {
  const raw = config.security.egressAllowlist
  if (!raw) return null
  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  return entries.length > 0 ? entries : null
}

/**
 * Local-development escape hatch. `WEBHOOK_ALLOW_PRIVATE_NETWORK=true` lets
 * webhooks target loopback/RFC1918 addresses so a developer can point an
 * automation at `http://127.0.0.1:3000/hook`.
 *
 * It is ignored when `NODE_ENV === 'production'` — the insecure mode must not
 * be reachable by flipping one env var on a deployed box.
 */
export function readAllowPrivateNetwork(): boolean {
  if (config.logging.nodeEnv === 'production') return false
  return config.security.allowPrivateNetwork
}

function resolveOptions(options: SsrfGuardOptions) {
  return {
    allowlist: options.allowlist === undefined ? readEgressAllowlist() : options.allowlist,
    allowPrivateNetwork: options.allowPrivateNetwork ?? readAllowPrivateNetwork(),
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxRedirects: options.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
    resolver: options.resolver ?? defaultResolver,
  }
}

async function defaultResolver(hostname: string): Promise<LookupAddress[]> {
  // `dns.lookup` (not `dns.resolve`) on purpose: it goes through the OS
  // resolver, so /etc/hosts entries and container DNS overrides are seen and
  // validated too, instead of being silently bypassed.
  return dnsLookup(hostname, { all: true, verbatim: true })
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export type ValidatedTarget = {
  url: URL
  /** The address the socket will be pinned to. */
  address: string
  family: 4 | 6
}

/**
 * Validates a URL completely: shape first, then DNS, then every resolved
 * address against the blocklist.
 *
 * @throws {SsrfBlockedError} if the URL is refused at any stage.
 * @returns the parsed URL plus the address the request must be pinned to.
 */
export async function assertPublicUrl(
  rawUrl: string,
  options: SsrfGuardOptions = {}
): Promise<ValidatedTarget> {
  const resolved = resolveOptions(options)
  const url = assertUrlShapeAllowed(rawUrl, {
    allowlist: resolved.allowlist,
    allowPrivateNetwork: resolved.allowPrivateNetwork,
  })

  const host = stripIpv6Brackets(url.hostname)

  if (isIpLiteral(host)) {
    // Literal address — already checked by assertUrlShapeAllowed (unless the
    // dev escape hatch is on). Nothing to resolve, nothing to rebind.
    return { url, address: host, family: parseIPv4(host) !== null ? 4 : 6 }
  }

  let addresses: LookupAddress[]
  try {
    addresses = await resolved.resolver(host)
  } catch {
    throw new SsrfBlockedError('unresolvable_host', 'dns-lookup-failed', host)
  }

  if (!addresses || addresses.length === 0) {
    throw new SsrfBlockedError('unresolvable_host', 'no-addresses', host)
  }

  if (!resolved.allowPrivateNetwork) {
    for (const entry of addresses) {
      // Fail on ANY blocked address rather than picking a "good" one: a
      // resolver returning both a public and a private A record is a rebinding
      // setup, not a legitimate multi-homed host.
      const reason = classifyIpAddress(entry.address)
      if (reason !== null) {
        throw new SsrfBlockedError('blocked_address', reason, host)
      }
    }
  }

  const chosen = addresses[0]
  return {
    url,
    address: chosen.address,
    family: chosen.family === 6 ? 6 : 4,
  }
}

// ---------------------------------------------------------------------------
// Pinned transport
// ---------------------------------------------------------------------------

type NodeLookup = NonNullable<http.ClientRequestArgs['lookup']>

/**
 * Builds a `net.connect` lookup that always yields the address we validated,
 * so no second DNS query can steer the socket elsewhere between validation and
 * connect (DNS rebinding).
 */
function pinnedLookup(address: string, family: 4 | 6): NodeLookup {
  return ((hostname: string, opts: unknown, callback: unknown) => {
    const cb = (typeof opts === 'function' ? opts : callback) as (
      err: NodeJS.ErrnoException | null,
      addressOrResults: string | LookupAddress[],
      family?: number
    ) => void
    const wantsAll = typeof opts === 'object' && opts !== null && (opts as { all?: boolean }).all
    if (wantsAll) {
      cb(null, [{ address, family }])
    } else {
      cb(null, address, family)
    }
  }) as NodeLookup

}

type HopResponse = {
  status: number
  statusText: string
  location: string | null
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/**
 * Headers that survive a cross-origin redirect. Everything else — including
 * the tenant's custom headers and the `x-inboxui-signing-secret` — is dropped,
 * so a redirect cannot be used to harvest a webhook secret.
 */
const CROSS_ORIGIN_SAFE_HEADERS = new Set(['accept', 'accept-encoding', 'content-type', 'user-agent'])

function stripSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
  const kept: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (CROSS_ORIGIN_SAFE_HEADERS.has(name.toLowerCase())) kept[name] = value
  }
  return kept
}

/**
 * Issues a single request against a pinned address and resolves as soon as the
 * status line and headers are in. The response body is destroyed unread.
 */
function requestOnce(
  target: ValidatedTarget,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  timeoutMs: number
): Promise<HopResponse> {
  return new Promise<HopResponse>((resolve, reject) => {
    const { url } = target
    const host = stripIpv6Brackets(url.hostname)
    const isHttps = url.protocol === 'https:'
    const transport = isHttps ? https : http
    let settled = false

    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: host,
        port: url.port !== '' ? Number(url.port) : isHttps ? 443 : 80,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
        lookup: pinnedLookup(target.address, target.family),
        timeout: timeoutMs,
        // No connection pooling: a pooled socket is keyed on host:port and
        // would not honour this request's pinned lookup.
        agent: false,
        ...(isHttps && !isIpLiteral(host) ? { servername: host } : {}),
      },
      (response) => {
        if (settled) return
        settled = true
        const location = typeof response.headers.location === 'string' ? response.headers.location : null
        const status = response.statusCode ?? 0
        const statusText = response.statusMessage ?? ''
        // Never read the body. Tear the socket down immediately so a hostile
        // endpoint cannot stream megabytes at us either.
        response.destroy()
        resolve({ status, statusText, location })
      }
    )

    request.on('timeout', () => {
      request.destroy(new Error(`Request timed out after ${timeoutMs}ms`))
    })
    request.on('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })

    if (body !== undefined) request.write(body)
    request.end()
  })
}

/**
 * Performs an outbound request that is safe against SSRF.
 *
 * Every hop (initial request and each redirect) is independently validated and
 * pinned. The response body is never read, so nothing from the upstream
 * response can be persisted or surfaced to the tenant.
 *
 * @throws {SsrfBlockedError} when the target — or any redirect target — is
 *   refused. Transport errors (DNS down, connection refused, timeout)
 *   propagate as ordinary `Error`s.
 */
export async function safeFetch(
  rawUrl: string,
  init: SafeFetchInit = {},
  options: SsrfGuardOptions = {}
): Promise<SafeFetchResult> {
  const resolved = resolveOptions(options)
  let method = (init.method ?? 'GET').toUpperCase()
  let body = init.body
  let headers = normalizeHeaders(init.headers, body)
  let currentUrl = rawUrl
  let currentOrigin: string | null = null

  for (let hop = 0; hop <= resolved.maxRedirects; hop += 1) {
    const target = await assertPublicUrl(currentUrl, options)

    if (currentOrigin !== null && target.url.origin !== currentOrigin) {
      headers = stripSensitiveHeaders(headers)
    }
    currentOrigin = target.url.origin

    const response = await requestOnce(target, method, headers, body, resolved.timeoutMs)

    const isRedirect = REDIRECT_STATUSES.has(response.status) && response.location !== null
    if (!isRedirect || hop === resolved.maxRedirects) {
      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        statusText: response.statusText,
        finalUrl: target.url.toString(),
        redirects: hop,
      }
    }

    let next: URL
    try {
      next = new URL(response.location as string, target.url)
    } catch {
      throw new SsrfBlockedError('invalid_url', 'bad-redirect-location', target.url.hostname)
    }

    // Mirror browser semantics: 303 (and 301/302 for non-GET) degrade to GET
    // and drop the body; 307/308 preserve method and body.
    if (response.status === 303 || (response.status !== 307 && response.status !== 308)) {
      if (method !== 'GET' && method !== 'HEAD') {
        method = 'GET'
        body = undefined
        headers = withoutBodyHeaders(headers)
      }
    }

    currentUrl = next.toString()
  }

  /* c8 ignore next */
  throw new SsrfBlockedError('too_many_redirects', 'redirect-limit-exceeded', rawUrl)
}

function normalizeHeaders(
  headers: Record<string, string> | undefined,
  body: string | undefined
): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers ?? {})) {
    normalized[name] = value
  }
  // Ask for an unencoded body: we discard it, and decompression would only
  // burn CPU on a response we never look at.
  normalized['accept-encoding'] = 'identity'
  if (body !== undefined && !hasHeader(normalized, 'content-length')) {
    normalized['content-length'] = String(Buffer.byteLength(body))
  }
  return normalized
}

function withoutBodyHeaders(headers: Record<string, string>): Record<string, string> {
  const kept: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase()
    if (lower === 'content-length' || lower === 'content-type') continue
    kept[name] = value
  }
  return kept
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name)
}
