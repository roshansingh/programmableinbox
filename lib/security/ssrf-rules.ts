/**
 * Pure SSRF classification rules — no Node built-ins, no I/O.
 *
 * This module is deliberately dependency-free so it can be imported from
 * anywhere (including code that ends up in the browser bundle, e.g. the
 * automation config zod schemas). Everything that needs DNS or a socket lives
 * in `./ssrf-guard`, which builds on top of these rules.
 *
 * The rules answer two questions:
 *   1. Is this literal IP address one we refuse to connect to?
 *   2. Is this hostname one we refuse to even resolve?
 *
 * Both are expressed as pure functions over strings so they are exhaustively
 * unit-testable without touching the network.
 */

/** Schemes we are willing to make an outbound request with. */
export const ALLOWED_SCHEMES = ['http:', 'https:'] as const

/** Machine-readable reason codes attached to {@link SsrfBlockedError}. */
export type SsrfBlockReason =
  | 'invalid_url'
  | 'blocked_scheme'
  | 'url_credentials'
  | 'empty_host'
  | 'blocked_hostname'
  | 'not_allowlisted'
  | 'blocked_address'
  | 'unresolvable_host'
  | 'too_many_redirects'
  | 'request_failed'

/**
 * Thrown whenever a request is refused by the guard. Carries a stable
 * `reason` code plus a short `detail` label so callers can record *why*
 * without echoing anything sensitive.
 */
export class SsrfBlockedError extends Error {
  readonly name = 'SsrfBlockedError'
  readonly reason: SsrfBlockReason
  readonly detail: string
  /** The host (never the full URL — paths/queries may hold secrets). */
  readonly host: string

  constructor(reason: SsrfBlockReason, detail: string, host: string) {
    super(`Outbound request blocked (${reason}: ${detail}) for host "${host}"`)
    this.reason = reason
    this.detail = detail
    this.host = host
  }
}

// ---------------------------------------------------------------------------
// Hostname rules
// ---------------------------------------------------------------------------

/**
 * Hostnames that must never be resolved. `metadata.google.internal` and
 * `metadata.goog` are GCP's metadata service; `instance-data` is the legacy
 * AWS alias. Anything under `.internal` / `.local` / `.home.arpa` /
 * `.localhost` is by definition not a public destination.
 */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'instance-data.ec2.internal',
])

const BLOCKED_HOSTNAME_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.home.arpa',
  '.in-addr.arpa',
  '.ip6.arpa',
]

/**
 * Classifies a hostname (already lower-cased and trailing-dot stripped by
 * {@link normalizeHostname}).
 *
 * @returns a short label describing why the hostname is blocked, or `null`
 *   when the hostname is acceptable *by name* (its resolved addresses still
 *   have to pass {@link classifyIpAddress}).
 */
export function classifyHostname(hostname: string): string | null {
  const host = normalizeHostname(hostname)
  if (host.length === 0) return 'empty'
  if (BLOCKED_HOSTNAMES.has(host)) return 'reserved-hostname'
  for (const suffix of BLOCKED_HOSTNAME_SUFFIXES) {
    if (host.endsWith(suffix)) return `reserved-suffix${suffix}`
  }
  return null
}

/** Lower-cases a hostname and strips the FQDN trailing dot (`a.com.` -> `a.com`). */
export function normalizeHostname(hostname: string): string {
  const lowered = hostname.trim().toLowerCase()
  return lowered.endsWith('.') ? lowered.slice(0, -1) : lowered
}

/**
 * `new URL('http://[::1]/').hostname` keeps the brackets. Strip them so the
 * address classifier sees a bare `::1` — forgetting this makes every IPv6
 * literal skip the blocklist and fall through to the DNS path.
 */
export function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

// ---------------------------------------------------------------------------
// IPv4
// ---------------------------------------------------------------------------

type Cidr4 = { readonly base: string; readonly bits: number; readonly label: string }

/**
 * IPv4 ranges we refuse to connect to. Beyond the obvious RFC1918 space this
 * covers the cloud metadata endpoints (all of AWS/GCP/Azure live at
 * 169.254.169.254, ECS task metadata at 169.254.170.2, Oracle at 192.0.0.192,
 * Alibaba at 100.100.100.200) plus every reserved/unroutable block, because a
 * webhook has no legitimate reason to target any of them.
 */
export const BLOCKED_IPV4_RANGES: readonly Cidr4[] = [
  { base: '0.0.0.0', bits: 8, label: 'this-network' },
  { base: '10.0.0.0', bits: 8, label: 'private-rfc1918' },
  { base: '100.64.0.0', bits: 10, label: 'cgnat-rfc6598' },
  { base: '127.0.0.0', bits: 8, label: 'loopback' },
  { base: '169.254.0.0', bits: 16, label: 'link-local-metadata' },
  { base: '172.16.0.0', bits: 12, label: 'private-rfc1918' },
  { base: '192.0.0.0', bits: 24, label: 'ietf-protocol-assignments' },
  { base: '192.0.2.0', bits: 24, label: 'test-net-1' },
  { base: '192.88.99.0', bits: 24, label: '6to4-relay-anycast' },
  { base: '192.168.0.0', bits: 16, label: 'private-rfc1918' },
  { base: '198.18.0.0', bits: 15, label: 'benchmarking' },
  { base: '198.51.100.0', bits: 24, label: 'test-net-2' },
  { base: '203.0.113.0', bits: 24, label: 'test-net-3' },
  { base: '224.0.0.0', bits: 4, label: 'multicast' },
  { base: '240.0.0.0', bits: 4, label: 'reserved-and-broadcast' },
]

/**
 * Parses a strict dotted-quad IPv4 address.
 *
 * Leading zeros are rejected: `010.0.0.1` is octal in some resolvers and a
 * classic filter bypass. (The WHATWG URL parser already normalises those
 * forms, but this function is also used on DNS results and raw input.)
 *
 * @returns the address as a 32-bit unsigned integer, or `null` if not IPv4.
 */
export function parseIPv4(input: string): number | null {
  const parts = input.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    if (part.length > 1 && part[0] === '0') return null
    const octet = Number(part)
    if (octet > 255) return null
    value = value * 256 + octet
  }
  return value >>> 0
}

function inCidr4(value: number, range: Cidr4): boolean {
  const base = parseIPv4(range.base)
  if (base === null) return false
  if (range.bits === 0) return true
  const mask = (0xffffffff << (32 - range.bits)) >>> 0
  return (value & mask) >>> 0 === (base & mask) >>> 0
}

/** @returns a label when the IPv4 address is blocked, else `null`. */
export function classifyIPv4(value: number): string | null {
  for (const range of BLOCKED_IPV4_RANGES) {
    if (inCidr4(value, range)) return `${range.label} (${range.base}/${range.bits})`
  }
  return null
}

// ---------------------------------------------------------------------------
// IPv6
// ---------------------------------------------------------------------------

/**
 * Parses an IPv6 address (with optional `::` compression and an optional
 * embedded dotted-quad tail) into 16 bytes.
 *
 * A zone id (`fe80::1%eth0`) is stripped here; the caller treats its presence
 * as blocked on its own, since scoped addresses are link-local by nature.
 *
 * @returns 16 bytes, or `null` if the input is not a valid IPv6 address.
 */
export function parseIPv6(input: string): Uint8Array | null {
  const zoneIndex = input.indexOf('%')
  let text = zoneIndex === -1 ? input : input.slice(0, zoneIndex)
  if (text.length === 0 || text.includes(':') === false) return null

  // Split off an embedded IPv4 tail (`::ffff:1.2.3.4`) and substitute two
  // zero hextets so the rest of the parse is uniform.
  let embeddedV4: number | null = null
  const lastColon = text.lastIndexOf(':')
  const tail = text.slice(lastColon + 1)
  if (tail.includes('.')) {
    embeddedV4 = parseIPv4(tail)
    if (embeddedV4 === null) return null
    text = `${text.slice(0, lastColon + 1)}0:0`
  }

  const halves = text.split('::')
  if (halves.length > 2) return null
  const compressed = halves.length === 2
  const headGroups = halves[0] ? halves[0].split(':') : []
  const tailGroups = compressed && halves[1] ? halves[1].split(':') : []
  const total = headGroups.length + tailGroups.length
  if (compressed ? total > 8 : total !== 8) return null

  const bytes = new Uint8Array(16)
  let head = 0
  for (const group of headGroups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null
    const word = parseInt(group, 16)
    bytes[head++] = word >> 8
    bytes[head++] = word & 0xff
  }
  let end = 16
  for (let i = tailGroups.length - 1; i >= 0; i -= 1) {
    const group = tailGroups[i]
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null
    const word = parseInt(group, 16)
    bytes[--end] = word & 0xff
    bytes[--end] = word >> 8
  }
  if (head > end) return null

  if (embeddedV4 !== null) {
    bytes[12] = (embeddedV4 >>> 24) & 0xff
    bytes[13] = (embeddedV4 >>> 16) & 0xff
    bytes[14] = (embeddedV4 >>> 8) & 0xff
    bytes[15] = embeddedV4 & 0xff
  }
  return bytes
}

function firstBytesAreZero(bytes: Uint8Array, count: number): boolean {
  for (let i = 0; i < count; i += 1) {
    if (bytes[i] !== 0) return false
  }
  return true
}

function embeddedIPv4(bytes: Uint8Array): number {
  return (((bytes[12] << 24) | (bytes[13] << 16) | (bytes[14] << 8) | bytes[15]) >>> 0)
}

/** @returns a label when the IPv6 address is blocked, else `null`. */
export function classifyIPv6(bytes: Uint8Array): string | null {
  // ::ffff:a.b.c.d — IPv4-mapped. THE classic blocklist bypass: `::ffff:127.0.0.1`
  // reaches loopback while looking like a v6 address. Re-run the v4 rules on the
  // embedded address instead of trusting the outer form.
  if (firstBytesAreZero(bytes, 10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    const mapped = classifyIPv4(embeddedIPv4(bytes))
    return mapped ? `ipv4-mapped -> ${mapped}` : null
  }

  // 64:ff9b::/96 and 64:ff9b:1::/48 — NAT64 translation prefixes; the last 32
  // bits are a real IPv4 destination, so apply the v4 rules there too.
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
    const mapped = classifyIPv4(embeddedIPv4(bytes))
    return mapped ? `nat64 -> ${mapped}` : null
  }

  if (firstBytesAreZero(bytes, 12)) {
    const trailing = embeddedIPv4(bytes)
    if (trailing === 0) return 'unspecified (::)'
    if (trailing === 1) return 'loopback (::1)'
    // ::a.b.c.d — deprecated IPv4-compatible form. Never legitimate.
    return 'ipv4-compatible (deprecated ::a.b.c.d)'
  }

  if ((bytes[0] & 0xfe) === 0xfc) return 'unique-local (fc00::/7)'
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return 'link-local (fe80::/10)'
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0) return 'site-local-deprecated (fec0::/10)'
  if (bytes[0] === 0xff) return 'multicast (ff00::/8)'
  // 2001::/32 Teredo and 2001:db8::/32 documentation.
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) {
    return 'teredo (2001::/32)'
  }
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) {
    return 'documentation (2001:db8::/32)'
  }
  // 2002::/16 6to4 — bytes 2..5 carry the encapsulated IPv4 endpoint.
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    const encapsulated = ((bytes[2] << 24) | (bytes[3] << 16) | (bytes[4] << 8) | bytes[5]) >>> 0
    const mapped = classifyIPv4(encapsulated)
    return mapped ? `6to4 -> ${mapped}` : null
  }
  return null
}

// ---------------------------------------------------------------------------
// Combined address classification
// ---------------------------------------------------------------------------

/**
 * Classifies any literal IP address (v4 or v6).
 *
 * @param address - a literal address, e.g. `10.0.0.1` or `::ffff:127.0.0.1`.
 * @returns a label when the address must not be connected to; `null` when it
 *   is a public, routable address. Anything unparseable is blocked — fail
 *   closed rather than assume it is safe.
 */
export function classifyIpAddress(address: string): string | null {
  const trimmed = address.trim()
  if (trimmed.length === 0) return 'empty-address'

  const v4 = parseIPv4(trimmed)
  if (v4 !== null) return classifyIPv4(v4)

  if (trimmed.includes('%')) return 'scoped-address (zone id implies link-local)'
  const v6 = parseIPv6(trimmed)
  if (v6 !== null) return classifyIPv6(v6)

  return 'unparseable-address'
}

/** Convenience predicate over {@link classifyIpAddress}. */
export function isBlockedIpAddress(address: string): boolean {
  return classifyIpAddress(address) !== null
}

/** True when the string is a literal IP address (either family). */
export function isIpLiteral(value: string): boolean {
  return parseIPv4(value) !== null || parseIPv6(value) !== null
}

// ---------------------------------------------------------------------------
// URL shape validation (synchronous, no DNS)
// ---------------------------------------------------------------------------

export type UrlShapeOptions = {
  /**
   * When set, the URL host must match one of these entries. An entry matches
   * either exactly (`hooks.example.com`) or as a domain suffix when written
   * with a leading dot (`.example.com` matches `a.b.example.com`).
   */
  allowlist?: readonly string[] | null
  /**
   * Escape hatch for local development: skips the private/loopback address
   * checks (scheme, hostname and allowlist checks still apply).
   */
  allowPrivateNetwork?: boolean
}

/**
 * Validates everything about a URL that can be checked without DNS: scheme,
 * embedded credentials, hostname blocklist, allowlist, and — when the host is
 * a literal IP — the address blocklist.
 *
 * @throws {SsrfBlockedError} when the URL must not be requested.
 * @returns the parsed, normalised URL.
 */
export function assertUrlShapeAllowed(rawUrl: string, options: UrlShapeOptions = {}): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new SsrfBlockedError('invalid_url', 'not-a-url', '<unparseable>')
  }

  if (!(ALLOWED_SCHEMES as readonly string[]).includes(url.protocol)) {
    throw new SsrfBlockedError('blocked_scheme', url.protocol.replace(':', ''), url.hostname || '<none>')
  }

  // Credentials in the URL are never needed for a webhook and are a common
  // ingredient in parser-confusion payloads (`https://good.com@169.254.169.254/`).
  if (url.username !== '' || url.password !== '') {
    throw new SsrfBlockedError('url_credentials', 'userinfo-present', url.hostname)
  }

  const host = stripIpv6Brackets(normalizeHostname(url.hostname))
  if (host.length === 0) {
    throw new SsrfBlockedError('empty_host', 'no-host', '<none>')
  }

  if (options.allowlist && options.allowlist.length > 0 && !matchesAllowlist(host, options.allowlist)) {
    throw new SsrfBlockedError('not_allowlisted', 'host-not-in-egress-allowlist', host)
  }

  const hostnameReason = classifyHostname(host)
  if (hostnameReason !== null) {
    throw new SsrfBlockedError('blocked_hostname', hostnameReason, host)
  }

  if (isIpLiteral(host) && !options.allowPrivateNetwork) {
    const addressReason = classifyIpAddress(host)
    if (addressReason !== null) {
      throw new SsrfBlockedError('blocked_address', addressReason, host)
    }
  }

  return url
}

/** Exact match, or suffix match for entries written with a leading dot. */
export function matchesAllowlist(host: string, allowlist: readonly string[]): boolean {
  const normalized = normalizeHostname(host)
  return allowlist.some((raw) => {
    const entry = normalizeHostname(raw)
    if (entry.length === 0) return false
    if (entry.startsWith('.')) return normalized.endsWith(entry)
    return normalized === entry
  })
}
