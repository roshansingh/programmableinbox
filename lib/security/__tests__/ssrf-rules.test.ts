import { describe, expect, it } from 'vitest'
import {
  SsrfBlockedError,
  assertUrlShapeAllowed,
  classifyHostname,
  classifyIpAddress,
  isBlockedIpAddress,
  isIpLiteral,
  matchesAllowlist,
  parseIPv4,
  parseIPv6,
} from '@/lib/security/ssrf-rules'

describe('parseIPv4', () => {
  it('parses dotted quads', () => {
    expect(parseIPv4('0.0.0.0')).toBe(0)
    expect(parseIPv4('127.0.0.1')).toBe(0x7f000001)
    expect(parseIPv4('255.255.255.255')).toBe(0xffffffff)
    expect(parseIPv4('8.8.8.8')).toBe(0x08080808)
  })

  it('rejects octal-looking octets, out-of-range octets and non-quads', () => {
    // 010.0.0.1 is octal in some resolvers — a classic blocklist bypass.
    expect(parseIPv4('010.0.0.1')).toBeNull()
    expect(parseIPv4('256.0.0.1')).toBeNull()
    expect(parseIPv4('1.2.3')).toBeNull()
    expect(parseIPv4('1.2.3.4.5')).toBeNull()
    expect(parseIPv4('example.com')).toBeNull()
    expect(parseIPv4('')).toBeNull()
  })
})

describe('parseIPv6', () => {
  it('parses compressed, full and IPv4-tailed forms', () => {
    expect(Array.from(parseIPv6('::1') as Uint8Array)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ])
    expect(Array.from(parseIPv6('::') as Uint8Array)).toEqual(new Array(16).fill(0))
    const mapped = parseIPv6('::ffff:127.0.0.1') as Uint8Array
    expect(Array.from(mapped.slice(10, 12))).toEqual([0xff, 0xff])
    expect(Array.from(mapped.slice(12))).toEqual([127, 0, 0, 1])
    const full = parseIPv6('2606:4700:4700:0000:0000:0000:0000:1111') as Uint8Array
    expect(Array.from(full.slice(0, 4))).toEqual([0x26, 0x06, 0x47, 0x00])
    expect(full[15]).toBe(0x11)
  })

  it('rejects malformed addresses', () => {
    expect(parseIPv6('1:2:3:4:5:6:7')).toBeNull()
    expect(parseIPv6('1:2:3:4:5:6:7:8:9')).toBeNull()
    expect(parseIPv6('1::2::3')).toBeNull()
    expect(parseIPv6('gggg::1')).toBeNull()
    expect(parseIPv6('127.0.0.1')).toBeNull()
    expect(parseIPv6('')).toBeNull()
  })
})

describe('classifyIpAddress — IPv4 blocklist', () => {
  const blocked: Array<[string, string]> = [
    ['0.0.0.0', 'this-network'],
    ['0.1.2.3', 'this-network'],
    ['10.0.0.5', 'private-rfc1918'],
    ['10.255.255.255', 'private-rfc1918'],
    ['100.64.0.1', 'cgnat'],
    ['100.100.100.200', 'cgnat'], // Alibaba Cloud metadata
    ['127.0.0.1', 'loopback'],
    ['127.1.2.3', 'loopback'],
    ['169.254.169.254', 'link-local'], // AWS / GCP / Azure metadata
    ['169.254.170.2', 'link-local'], // ECS task metadata
    ['172.16.0.1', 'private-rfc1918'],
    ['172.31.255.254', 'private-rfc1918'],
    ['192.0.0.192', 'ietf-protocol'], // Oracle Cloud metadata
    ['192.0.2.10', 'test-net-1'],
    ['192.88.99.1', '6to4-relay'],
    ['192.168.1.1', 'private-rfc1918'],
    ['198.18.0.1', 'benchmarking'],
    ['198.51.100.7', 'test-net-2'],
    ['203.0.113.7', 'test-net-3'],
    ['224.0.0.1', 'multicast'],
    ['239.255.255.250', 'multicast'],
    ['240.0.0.1', 'reserved'],
    ['255.255.255.255', 'reserved'],
  ]

  it.each(blocked)('blocks %s (%s)', (address, label) => {
    const reason = classifyIpAddress(address)
    expect(reason, `${address} should be blocked`).not.toBeNull()
    expect(reason).toContain(label)
  })

  it.each([
    ['8.8.8.8'],
    ['1.1.1.1'],
    ['172.15.255.255'], // just below 172.16/12
    ['172.32.0.1'], // just above 172.16/12
    ['100.63.255.255'], // just below 100.64/10
    ['100.128.0.1'], // just above 100.64/10
    ['9.255.255.255'], // just below 10/8
    ['11.0.0.1'], // just above 10/8
    ['126.255.255.255'], // just below 127/8
    ['128.0.0.1'], // just above 127/8
    ['169.253.255.255'], // just below 169.254/16
    ['169.255.0.1'], // just above 169.254/16
    ['198.17.255.255'], // just below 198.18/15
    ['198.20.0.1'], // just above 198.18/15
    ['223.255.255.255'], // just below multicast
    ['93.184.216.34'],
  ])('allows public address %s', (address) => {
    expect(classifyIpAddress(address)).toBeNull()
  })
})

describe('classifyIpAddress — IPv6 blocklist', () => {
  const blocked: Array<[string, string]> = [
    ['::1', 'loopback'],
    ['::', 'unspecified'],
    ['fc00::1', 'unique-local'],
    ['fd12:3456:789a::1', 'unique-local'],
    ['fe80::1', 'link-local'],
    ['febf::1', 'link-local'],
    ['fec0::1', 'site-local'],
    ['ff02::1', 'multicast'],
    ['2001:db8::1', 'documentation'],
    ['2001:0:5ef5:79fb::1', 'teredo'],
    ['fe80::1%eth0', 'scoped-address'],
  ]

  it.each(blocked)('blocks %s (%s)', (address, label) => {
    const reason = classifyIpAddress(address)
    expect(reason, `${address} should be blocked`).not.toBeNull()
    expect(reason).toContain(label)
  })

  // The headline bypass from issue #39: an IPv4-mapped IPv6 literal that reaches
  // loopback / RFC1918 / the metadata service while looking like a v6 address.
  it.each([
    ['::ffff:127.0.0.1', 'loopback'],
    ['::ffff:169.254.169.254', 'link-local'],
    ['::ffff:10.0.0.1', 'private-rfc1918'],
    ['::ffff:192.168.0.1', 'private-rfc1918'],
    ['::ffff:7f00:1', 'loopback'], // same address in hextet form
  ])('blocks IPv4-mapped %s (%s)', (address, label) => {
    const reason = classifyIpAddress(address)
    expect(reason, `${address} should be blocked`).not.toBeNull()
    expect(reason).toContain('ipv4-mapped')
    expect(reason).toContain(label)
  })

  it('blocks the deprecated IPv4-compatible form ::a.b.c.d', () => {
    expect(classifyIpAddress('::127.0.0.1')).toContain('ipv4-compatible')
    expect(classifyIpAddress('::8.8.8.8')).toContain('ipv4-compatible')
  })

  it('blocks NAT64 and 6to4 wrappers around private IPv4 space', () => {
    expect(classifyIpAddress('64:ff9b::169.254.169.254')).toContain('nat64')
    expect(classifyIpAddress('2002:7f00:0001::1')).toContain('6to4')
  })

  it('allows public IPv6 addresses', () => {
    expect(classifyIpAddress('2606:4700:4700::1111')).toBeNull()
    expect(classifyIpAddress('2001:4860:4860::8888')).toBeNull()
    expect(classifyIpAddress('::ffff:8.8.8.8')).toBeNull()
  })

  it('fails closed on anything it cannot parse', () => {
    expect(classifyIpAddress('not-an-address')).toBe('unparseable-address')
    expect(classifyIpAddress('  ')).toBe('empty-address')
    expect(isBlockedIpAddress('nonsense')).toBe(true)
  })
})

describe('classifyHostname', () => {
  it.each([
    'localhost',
    'LOCALHOST',
    'api.localhost',
    'metadata.google.internal',
    'metadata.goog',
    'metadata',
    'instance-data',
    'anything.internal',
    'printer.local',
    'router.home.arpa',
  ])('blocks %s', (hostname) => {
    expect(classifyHostname(hostname)).not.toBeNull()
  })

  it.each(['example.com', 'hooks.slack.com', 'internal.example.com', 'localhost.example.com'])(
    'allows %s by name',
    (hostname) => {
      expect(classifyHostname(hostname)).toBeNull()
    }
  )

  it('normalises trailing dots so localhost. cannot slip through', () => {
    expect(classifyHostname('localhost.')).not.toBeNull()
  })
})

describe('isIpLiteral', () => {
  it('recognises both families', () => {
    expect(isIpLiteral('1.2.3.4')).toBe(true)
    expect(isIpLiteral('::1')).toBe(true)
    expect(isIpLiteral('example.com')).toBe(false)
  })
})

describe('matchesAllowlist', () => {
  it('matches exact hosts and leading-dot suffixes', () => {
    expect(matchesAllowlist('hooks.example.com', ['hooks.example.com'])).toBe(true)
    expect(matchesAllowlist('a.b.example.com', ['.example.com'])).toBe(true)
    expect(matchesAllowlist('example.com', ['.example.com'])).toBe(false)
    expect(matchesAllowlist('evil.com', ['hooks.example.com'])).toBe(false)
    expect(matchesAllowlist('evil-example.com', ['.example.com'])).toBe(false)
  })
})

describe('assertUrlShapeAllowed', () => {
  function reasonOf(fn: () => unknown): string {
    try {
      fn()
    } catch (error) {
      if (error instanceof SsrfBlockedError) return error.reason
      throw error
    }
    throw new Error('expected SsrfBlockedError')
  }

  it('accepts ordinary http(s) URLs', () => {
    expect(assertUrlShapeAllowed('https://hooks.example.com/x?y=1').hostname).toBe('hooks.example.com')
    expect(assertUrlShapeAllowed('http://example.com/').protocol).toBe('http:')
  })

  it.each([
    'file:///etc/passwd',
    'gopher://example.com/',
    'ftp://example.com/',
    'data:text/plain,hi',
    'jar:http://example.com/!/',
  ])('rejects non-http(s) scheme %s', (url) => {
    expect(reasonOf(() => assertUrlShapeAllowed(url))).toBe('blocked_scheme')
  })

  it('rejects garbage input', () => {
    expect(reasonOf(() => assertUrlShapeAllowed('not a url'))).toBe('invalid_url')
  })

  it('rejects embedded credentials used for parser confusion', () => {
    expect(reasonOf(() => assertUrlShapeAllowed('https://example.com@169.254.169.254/'))).toBe(
      'url_credentials'
    )
  })

  it.each([
    'http://localhost:6379/',
    'http://api.localhost/',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://anything.internal/',
  ])('rejects blocked hostname %s', (url) => {
    expect(reasonOf(() => assertUrlShapeAllowed(url))).toBe('blocked_hostname')
  })

  it.each([
    'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
    'http://127.0.0.1:6379/',
    'http://10.0.0.5/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[fd00::1]/',
    'http://0.0.0.0:8080/',
  ])('rejects blocked literal address %s', (url) => {
    expect(reasonOf(() => assertUrlShapeAllowed(url))).toBe('blocked_address')
  })

  it('rejects decimal and hex encodings of loopback (normalised by the URL parser)', () => {
    expect(reasonOf(() => assertUrlShapeAllowed('http://2130706433/'))).toBe('blocked_address')
    expect(reasonOf(() => assertUrlShapeAllowed('http://0x7f000001/'))).toBe('blocked_address')
    expect(reasonOf(() => assertUrlShapeAllowed('http://017700000001/'))).toBe('blocked_address')
  })

  it('enforces the egress allowlist when one is supplied', () => {
    expect(
      assertUrlShapeAllowed('https://hooks.example.com/x', { allowlist: ['.example.com'] }).hostname
    ).toBe('hooks.example.com')
    expect(
      reasonOf(() => assertUrlShapeAllowed('https://evil.com/x', { allowlist: ['.example.com'] }))
    ).toBe('not_allowlisted')
  })

  it('lets the dev escape hatch through private addresses but not other rules', () => {
    expect(
      assertUrlShapeAllowed('http://127.0.0.1:3000/hook', { allowPrivateNetwork: true }).port
    ).toBe('3000')
    // Scheme and hostname rules still apply with the escape hatch on.
    expect(
      reasonOf(() => assertUrlShapeAllowed('file:///etc/passwd', { allowPrivateNetwork: true }))
    ).toBe('blocked_scheme')
    expect(
      reasonOf(() => assertUrlShapeAllowed('http://localhost:3000/', { allowPrivateNetwork: true }))
    ).toBe('blocked_hostname')
  })

  it('never puts the URL path or query into the error message', () => {
    try {
      assertUrlShapeAllowed('http://169.254.169.254/latest/meta-data/?token=supersecret')
      throw new Error('expected throw')
    } catch (error) {
      expect(error).toBeInstanceOf(SsrfBlockedError)
      expect((error as SsrfBlockedError).message).not.toContain('supersecret')
      expect((error as SsrfBlockedError).host).toBe('169.254.169.254')
    }
  })
})
