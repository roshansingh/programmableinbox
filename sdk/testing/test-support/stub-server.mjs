import { createServer } from 'node:http'

/**
 * A minimal stand-in for the PIBX v1 endpoints the package calls.
 * `routes` maps "METHOD /path" to (req, url, body) => { status, body?, headers? }
 * (or a promise of one). Every request is recorded in `requests` so tests can
 * assert on headers and query strings exactly as a real server saw them.
 *
 * Node adds a `Date` header to every response unless the route sets its own,
 * which is what the package's server-time lookup reads.
 */
export async function startStub(routes) {
  const requests = []
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const raw = Buffer.concat(chunks).toString('utf8')
    const url = new URL(req.url, 'http://stub')
    requests.push({
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: req.headers,
      body: raw ? JSON.parse(raw) : undefined,
    })
    const route = routes[`${req.method} ${url.pathname}`]
    if (!route) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ message: 'no stub route' }))
      return
    }
    const out = await route(req, url, raw)
    res.writeHead(out.status, { 'content-type': 'application/json', ...(out.headers ?? {}) })
    res.end(typeof out.body === 'string' ? out.body : JSON.stringify(out.body ?? {}))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        // A route that never answers (the request-timeout tests) would otherwise
        // keep its socket open and hang the close.
        server.closeAllConnections?.()
        server.close(() => resolve(undefined))
      }),
  }
}
