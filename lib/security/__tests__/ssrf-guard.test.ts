import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetConfigCache } from '@/lib/config'
import {
  SsrfBlockedError,
  assertPublicUrl,
  readAllowPrivateNetwork,
  readEgressAllowlist,
  safeFetch,
} from '@/lib/security/ssrf-guard'

// ---------------------------------------------------------------------------
// Test harness — real loopback HTTP servers
// ---------------------------------------------------------------------------

type RecordedRequest = {
  method: string
  url: string
  headers: http.IncomingHttpHeaders
  body: string
}

type TestServer = {
  port: number
  origin: string
  requests: RecordedRequest[]
  close: () => Promise<void>
}

const openServers: TestServer[] = []

async function startServer(
  handler: (request: RecordedRequest, response: http.ServerResponse) => void
): Promise<TestServer> {
  const requests: RecordedRequest[] = []
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const recorded: RecordedRequest = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }
      requests.push(recorded)
      handler(recorded, res)
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port

  const testServer: TestServer = {
    port,
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
  openServers.push(testServer)
  return testServer
}

afterEach(async () => {
  vi.unstubAllEnvs()
  // Config memoizes per domain, so restoring the env is only half the job —
  // without this a suite leaks its parse into the tests that follow.
  resetConfigCache()
  await Promise.all(openServers.splice(0).map((server) => server.close()))
})

/** Loopback is blocked by default, so local-server tests opt into the dev hatch. */
const LOCAL = { allowPrivateNetwork: true } as const

async function expectBlocked(promise: Promise<unknown>): Promise<SsrfBlockedError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(SsrfBlockedError)
    return error as SsrfBlockedError
  }
  throw new Error('expected the request to be blocked')
}

// ---------------------------------------------------------------------------
// assertPublicUrl — resolve-then-validate
// ---------------------------------------------------------------------------

describe('assertPublicUrl', () => {
  const resolverFor = (addresses: Array<{ address: string; family: number }>) =>
    vi.fn(async () => addresses)

  it('accepts a hostname whose addresses are all public, and pins the first', async () => {
    const resolver = resolverFor([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700::1111', family: 6 },
    ])
    const target = await assertPublicUrl('https://hooks.example.com/x', { resolver })
    expect(resolver).toHaveBeenCalledWith('hooks.example.com')
    expect(target.address).toBe('93.184.216.34')
    expect(target.family).toBe(4)
    expect(target.url.hostname).toBe('hooks.example.com')
  })

  it('blocks a hostname that resolves to a private address (DNS-level SSRF)', async () => {
    const error = await expectBlocked(
      assertPublicUrl('https://evil.example.com/x', {
        resolver: resolverFor([{ address: '169.254.169.254', family: 4 }]),
      })
    )
    expect(error.reason).toBe('blocked_address')
    expect(error.detail).toContain('link-local')
  })

  it('blocks when ANY resolved address is private, even if a public one is offered first', async () => {
    // A resolver handing back both a public and a private record is a rebinding
    // setup, not a legitimate multi-homed host — refuse the whole name.
    const error = await expectBlocked(
      assertPublicUrl('https://mixed.example.com/x', {
        resolver: resolverFor([
          { address: '93.184.216.34', family: 4 },
          { address: '10.0.0.5', family: 4 },
        ]),
      })
    )
    expect(error.reason).toBe('blocked_address')
    expect(error.detail).toContain('private-rfc1918')
  })

  it('blocks IPv4-mapped IPv6 answers from DNS', async () => {
    const error = await expectBlocked(
      assertPublicUrl('https://sneaky.example.com/x', {
        resolver: resolverFor([{ address: '::ffff:127.0.0.1', family: 6 }]),
      })
    )
    expect(error.reason).toBe('blocked_address')
    expect(error.detail).toContain('ipv4-mapped')
  })

  it('fails closed when the name does not resolve or returns nothing', async () => {
    const failing = await expectBlocked(
      assertPublicUrl('https://nope.example.com/', {
        resolver: vi.fn(async () => {
          throw new Error('ENOTFOUND')
        }),
      })
    )
    expect(failing.reason).toBe('unresolvable_host')

    const empty = await expectBlocked(
      assertPublicUrl('https://nope.example.com/', { resolver: resolverFor([]) })
    )
    expect(empty.reason).toBe('unresolvable_host')
  })

  it('never resolves a literal IP — the blocklist already settled it', async () => {
    const resolver = resolverFor([{ address: '93.184.216.34', family: 4 }])
    await expectBlocked(assertPublicUrl('http://169.254.169.254/latest/meta-data/', { resolver }))
    expect(resolver).not.toHaveBeenCalled()
  })

  it('applies the egress allowlist before doing any DNS work', async () => {
    const resolver = resolverFor([{ address: '93.184.216.34', family: 4 }])
    const error = await expectBlocked(
      assertPublicUrl('https://evil.com/x', { allowlist: ['.example.com'], resolver })
    )
    expect(error.reason).toBe('not_allowlisted')
    expect(resolver).not.toHaveBeenCalled()

    const allowed = await assertPublicUrl('https://hooks.example.com/x', {
      allowlist: ['.example.com'],
      resolver,
    })
    expect(allowed.address).toBe('93.184.216.34')
  })
})

// ---------------------------------------------------------------------------
// safeFetch — transport, body handling, redirects, pinning
// ---------------------------------------------------------------------------

describe('safeFetch', () => {
  it('sends method, headers and body to the target and reports the status', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(202, { 'content-type': 'text/plain' })
      res.end('accepted')
    })

    const result = await safeFetch(
      `${server.origin}/hook?x=1`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-programmableinbox-signing-secret': 's3cret' },
        body: '{"hello":"world"}',
      },
      LOCAL
    )

    expect(result).toEqual({
      ok: true,
      status: 202,
      statusText: 'Accepted',
      finalUrl: `${server.origin}/hook?x=1`,
      redirects: 0,
    })

    expect(server.requests).toHaveLength(1)
    const received = server.requests[0]
    expect(received.method).toBe('POST')
    expect(received.url).toBe('/hook?x=1')
    expect(received.body).toBe('{"hello":"world"}')
    expect(received.headers['content-type']).toBe('application/json')
    expect(received.headers['x-programmableinbox-signing-secret']).toBe('s3cret')
    expect(received.headers['content-length']).toBe('17')
  })

  it('never returns the upstream response body, even on a failure status', async () => {
    const secret = 'ACCESS_KEY_ID=AKIAEXFILTRATED'
    const server = await startServer((_req, res) => {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end(secret)
    })

    const result = await safeFetch(`${server.origin}/hook`, { method: 'POST', body: '{}' }, LOCAL)

    expect(result.ok).toBe(false)
    expect(result.status).toBe(500)
    // The shape itself carries no body field — there is nothing to leak.
    expect(Object.keys(result).sort()).toEqual(['finalUrl', 'ok', 'redirects', 'status', 'statusText'])
    expect(JSON.stringify(result)).not.toContain('AKIAEXFILTRATED')
  })

  it('pins the socket to the validated address instead of re-resolving the hostname', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200)
      res.end()
    })

    // `.invalid` is guaranteed by RFC 2606 never to resolve. The request can
    // only succeed if the connection used the address the guard validated and
    // pinned, rather than performing its own DNS lookup at connect time.
    const result = await safeFetch(
      `http://webhook.test.invalid:${server.port}/hook`,
      { method: 'POST', body: '{}' },
      { ...LOCAL, resolver: async () => [{ address: '127.0.0.1', family: 4 }] }
    )

    expect(result.status).toBe(200)
    expect(server.requests).toHaveLength(1)
    // The Host header still carries the real hostname, so vhosts keep working.
    expect(server.requests[0].headers.host).toBe(`webhook.test.invalid:${server.port}`)
  })

  it('re-validates redirect targets and refuses a bounce to the metadata service', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(302, { location: 'http://metadata.google.internal/computeMetadata/v1/' })
      res.end()
    })

    const error = await expectBlocked(
      safeFetch(`${server.origin}/hook`, { method: 'POST', body: '{}' }, LOCAL)
    )
    expect(error.reason).toBe('blocked_hostname')
    expect(error.host).toBe('metadata.google.internal')
    // The first hop did happen; the redirect is what got stopped.
    expect(server.requests).toHaveLength(1)
  })

  it('refuses a redirect that switches to a non-http scheme', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(301, { location: 'file:///etc/passwd' })
      res.end()
    })

    const error = await expectBlocked(safeFetch(`${server.origin}/hook`, { method: 'POST' }, LOCAL))
    expect(error.reason).toBe('blocked_scheme')
  })

  it('follows an allowed redirect and reports the final hop', async () => {
    const destination = await startServer((_req, res) => {
      res.writeHead(200)
      res.end()
    })
    const entry = await startServer((_req, res) => {
      res.writeHead(307, { location: `${destination.origin}/final` })
      res.end()
    })

    const result = await safeFetch(
      `${entry.origin}/hook`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' },
      LOCAL
    )

    expect(result.status).toBe(200)
    expect(result.redirects).toBe(1)
    expect(result.finalUrl).toBe(`${destination.origin}/final`)
    // 307 preserves method and body.
    expect(destination.requests[0].method).toBe('POST')
    expect(destination.requests[0].body).toBe('{"a":1}')
  })

  it('drops the signing secret and custom headers on a cross-origin redirect', async () => {
    const destination = await startServer((_req, res) => {
      res.writeHead(200)
      res.end()
    })
    const entry = await startServer((_req, res) => {
      res.writeHead(307, { location: `${destination.origin}/final` })
      res.end()
    })

    await safeFetch(
      `${entry.origin}/hook`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-programmableinbox-signing-secret': 'do-not-leak',
          authorization: 'Bearer do-not-leak',
          'x-custom-tenant-header': 'do-not-leak',
        },
        body: '{}',
      },
      LOCAL
    )

    expect(entry.requests[0].headers['x-programmableinbox-signing-secret']).toBe('do-not-leak')
    expect(destination.requests[0].headers['x-programmableinbox-signing-secret']).toBeUndefined()
    expect(destination.requests[0].headers.authorization).toBeUndefined()
    expect(destination.requests[0].headers['x-custom-tenant-header']).toBeUndefined()
    // Same-origin-safe headers survive.
    expect(destination.requests[0].headers['content-type']).toBe('application/json')
  })

  it('degrades POST to GET and drops the body on a 303', async () => {
    const destination = await startServer((_req, res) => {
      res.writeHead(200)
      res.end()
    })
    const entry = await startServer((_req, res) => {
      res.writeHead(303, { location: `${destination.origin}/final` })
      res.end()
    })

    await safeFetch(`${entry.origin}/hook`, { method: 'POST', body: '{"a":1}' }, LOCAL)

    expect(destination.requests[0].method).toBe('GET')
    expect(destination.requests[0].body).toBe('')
    expect(destination.requests[0].headers['content-length']).toBeUndefined()
  })

  it('stops following after the redirect limit and returns the 3xx as the result', async () => {
    const server = await startServer((req, res) => {
      res.writeHead(302, { location: `${server.origin}${req.url}` })
      res.end()
    })

    const result = await safeFetch(
      `${server.origin}/loop`,
      { method: 'POST', body: '{}' },
      { ...LOCAL, maxRedirects: 2 }
    )

    expect(result.status).toBe(302)
    expect(result.ok).toBe(false)
    expect(result.redirects).toBe(2)
    // Initial request + 2 followed hops.
    expect(server.requests).toHaveLength(3)
  })

  it('does not follow redirects at all when maxRedirects is 0', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(302, { location: 'http://169.254.169.254/' })
      res.end()
    })

    const result = await safeFetch(
      `${server.origin}/hook`,
      { method: 'POST', body: '{}' },
      { ...LOCAL, maxRedirects: 0 }
    )

    expect(result.status).toBe(302)
    expect(server.requests).toHaveLength(1)
  })

  it('blocks before opening a socket when the URL is a blocked literal address', async () => {
    const error = await expectBlocked(
      safeFetch('http://169.254.169.254/latest/meta-data/iam/security-credentials/', {
        method: 'POST',
        body: '{}',
      })
    )
    expect(error.reason).toBe('blocked_address')
  })

  it('surfaces transport failures as ordinary errors, not SsrfBlockedError', async () => {
    const server = await startServer((_req, res) => res.end())
    const { port } = server
    await server.close()
    openServers.splice(openServers.indexOf(server), 1)

    await expect(
      safeFetch(`http://127.0.0.1:${port}/gone`, { method: 'POST', body: '{}' }, LOCAL)
    ).rejects.toThrow(/ECONNREFUSED/)
  })
})

// ---------------------------------------------------------------------------
// Environment configuration
// ---------------------------------------------------------------------------

describe('environment configuration', () => {
  // These read config repeatedly with different values inside one test. Config
  // memoizes per domain, so each change needs the memo cleared to take effect.
  it('parses WEBHOOK_EGRESS_ALLOWLIST', () => {
    vi.stubEnv('WEBHOOK_EGRESS_ALLOWLIST', '')
    resetConfigCache()
    expect(readEgressAllowlist()).toBeNull()

    vi.stubEnv('WEBHOOK_EGRESS_ALLOWLIST', ' hooks.example.com , .partner.io ')
    resetConfigCache()
    expect(readEgressAllowlist()).toEqual(['hooks.example.com', '.partner.io'])
  })

  it('honours the private-network escape hatch outside production only', () => {
    vi.stubEnv('WEBHOOK_ALLOW_PRIVATE_NETWORK', 'true')
    vi.stubEnv('NODE_ENV', 'development')
    resetConfigCache()
    expect(readAllowPrivateNetwork()).toBe(true)

    vi.stubEnv('NODE_ENV', 'production')
    resetConfigCache()
    expect(readAllowPrivateNetwork()).toBe(false)

    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('WEBHOOK_ALLOW_PRIVATE_NETWORK', 'false')
    resetConfigCache()
    expect(readAllowPrivateNetwork()).toBe(false)
  })

  it('rejects an unrecognised WEBHOOK_ALLOW_PRIVATE_NETWORK rather than reading it as false', () => {
    // Silently reading a typo as "off" is the safe direction here, but it also
    // means an operator who meant to enable the hatch gets no feedback.
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('WEBHOOK_ALLOW_PRIVATE_NETWORK', 'yes-please')
    resetConfigCache()
    expect(() => readAllowPrivateNetwork()).toThrow(/WEBHOOK_ALLOW_PRIVATE_NETWORK/)
  })

  it('blocks loopback by default when the escape hatch is off', async () => {
    vi.stubEnv('WEBHOOK_ALLOW_PRIVATE_NETWORK', '')
    const server = await startServer((_req, res) => res.end())
    const error = await expectBlocked(safeFetch(`${server.origin}/hook`, { method: 'POST' }))
    expect(error.reason).toBe('blocked_address')
    expect(error.detail).toContain('loopback')
    expect(server.requests).toHaveLength(0)
  })
})
