# `@programmableinbox/testing` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a hand-written npm package at `sdk/testing` that lets Cypress and Playwright tests claim a PIBX inbox and wait for a one-time code or message.

**Architecture:** A zero-dependency core client (`fetch` + a poll loop) is wrapped by two thin adapters: a Cypress Node-task/support-command pair and a Playwright fixture object. The API key is only ever read in Node. Unit tests run against a real local `node:http` stub inside the repo's root vitest `node` project; real-framework smoke tests are a package-local script.

**Tech Stack:** TypeScript (tsc, CJS + ESM builds), vitest, `node:http`, Node 18+ global `fetch`; Cypress and `@playwright/test` as optional peers.

**Spec:** `docs/superpowers/specs/2026-10-09-testing-package-design.md`

## Global Constraints

- Package name `@programmableinbox/testing`, directory `sdk/testing/` (spec open question 1 and 2, approved).
- Subpath exports exactly: `.`, `./cypress`, `./cypress/support`, `./playwright`.
- Zero runtime `dependencies`. Cypress and `@playwright/test` are `peerDependencies` marked optional in `peerDependenciesMeta`.
- Node 18+ (global `fetch`); `engines.node` is `>=18`.
- `since` is a **required** argument on `waitForOtp` and `waitForMessage`; never defaulted.
- `apiKey` defaults to `PIBX_API_KEY`, `baseUrl` to `PIBX_BASE_URL`, then `https://app.programmableinbox.com`. A missing key throws at construction naming `PIBX_API_KEY`.
- Defaults: poll interval 2000 ms, timeout 60000 ms.
- 401/403 never retry; 404, 429 and 5xx retry until the deadline.
- The package never auto-creates or auto-deletes inboxes. No site-specific (ChatGPT) helper.
- Per `CLAUDE.md`: all work in a worktree; `npm run test` must pass before any PR; the suite's test count must not decrease.

## Review Focus

Failure modes the spec implies but no obvious happy-path test exercises, most likely first:

1. **Unparseable `since`** (`'yesterday'`, `''`, `Invalid Date`): must throw `TypeError` immediately, not poll to timeout comparing against `NaN`. Pinned in Task 2.
2. **`baseUrl` with a trailing slash or a path prefix** (`https://host/pibx/`): the request must still land on `/pibx/api/v1/...`, which `new URL('/api/…', base)` would silently break. Pinned in Task 2.
3. **Inbox id containing URL-reserved characters** (`a/b`, `a?b`): must be percent-encoded into the path, not alter the route. Pinned in Task 2.
4. **A `200` whose body is not the expected JSON** (an HTML error page from a proxy, or `data.otp` missing): must be a `PibxHttpError`, not a `TypeError` from reading `undefined`. Pinned in Task 2.
5. **The API key leaking into an error message or `toString`**: errors carry status and path only. Pinned in Task 2.

Also pinned: `timeoutMs: 0` still makes exactly one attempt (Task 1), and a `429` with `Retry-After` is honoured but never sleeps past the deadline (Task 1).

---

## File Structure

```
sdk/testing/
  package.json
  tsconfig.json            # CJS build  -> dist/
  tsconfig.esm.json        # ESM build  -> dist/esm/
  README.md
  scripts/postbuild.mjs    # writes dist/esm/package.json {"type":"module"}
  src/
    errors.ts              # PibxError, PibxAuthError, PibxHttpError, PibxTimeoutError
    poll.ts                # poll(), Clock
    client.ts              # createPibxClient, types
    index.ts               # re-exports core
    cypress/index.ts       # pibxTasks (Node side)
    cypress/support.ts     # commands + Chainable augmentation (browser side)
    playwright/index.ts    # pibxFixtures
    __tests__/
      poll.test.ts
      client.test.ts
      cypress.test.ts
      playwright.test.ts
  test-support/stub-server.mjs   # node:http stub of the PIBX endpoints used by unit + e2e
  e2e/                           # package-local real-framework smoke tests (not in root npm test)
    run.mjs, cypress.config.ts, cypress/e2e/otp.cy.ts, playwright.config.ts, otp.spec.ts
```

Modified outside the package: `vitest.config.ts` (include), `eslint.config.mjs` and `lib/config/__tests__/no-raw-env.test.ts` (allowlists), `sdk/README.md`, `.gitignore`, `docs/guides/cypress-chatgpt-login.md`.

**Out of scope for this plan (deviation from the spec's "Release" section, flagged for the reviewer):** the `release.yml` publish job and `scripts/release/{sdk-manifest,registry-status,check-sdk}.mjs` changes. Those touch shared release scripts that have their own test suite under `scripts/__tests__`, and the package cannot publish until the npm Trusted Publisher for the new package name is configured. They get their own plan once the package exists; nothing here blocks on them.

---

### Task 1: Scaffold, errors and the poll loop

**Files:**
- Create: `sdk/testing/package.json`, `sdk/testing/tsconfig.json`, `sdk/testing/tsconfig.esm.json`, `sdk/testing/scripts/postbuild.mjs`
- Create: `sdk/testing/src/errors.ts`, `sdk/testing/src/poll.ts`
- Test: `sdk/testing/src/__tests__/poll.test.ts`
- Modify: `vitest.config.ts` (node project `include`), `.gitignore`

**Interfaces:**
- Produces (`errors.ts`):
  ```ts
  export class PibxError extends Error {}
  export class PibxAuthError extends PibxError { readonly status: number }
  export class PibxHttpError extends PibxError { readonly status: number; readonly path: string }
  export class PibxTimeoutError extends PibxError { readonly lastStatus: number | undefined }
  ```
- Produces (`poll.ts`):
  ```ts
  export interface Clock { now(): number; sleep(ms: number): Promise<void> }
  export const realClock: Clock
  export type Attempt<T> =
    | { done: true; value: T }
    | { done: false; lastStatus?: number; retryAfterMs?: number }
  export function poll<T>(
    attempt: () => Promise<Attempt<T>>,
    opts: { timeoutMs: number; intervalMs: number; describe: string; clock?: Clock },
  ): Promise<T>
  ```

- [ ] **Step 1: Create the package manifest and configs**

`sdk/testing/package.json`:

```json
{
  "name": "@programmableinbox/testing",
  "version": "0.1.0",
  "description": "Cypress and Playwright helpers for reading ProgrammableInbox inboxes in end-to-end tests",
  "repository": {
    "type": "git",
    "url": "https://github.com/roshansingh/programmableinbox.git",
    "directory": "sdk/testing"
  },
  "engines": { "node": ">=18" },
  "files": ["dist", "README.md"],
  "main": "./dist/index.js",
  "module": "./dist/esm/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/esm/index.js",
      "require": "./dist/index.js"
    },
    "./cypress": {
      "types": "./dist/cypress/index.d.ts",
      "import": "./dist/esm/cypress/index.js",
      "require": "./dist/cypress/index.js"
    },
    "./cypress/support": {
      "types": "./dist/cypress/support.d.ts",
      "import": "./dist/esm/cypress/support.js",
      "require": "./dist/cypress/support.js"
    },
    "./playwright": {
      "types": "./dist/playwright/index.d.ts",
      "import": "./dist/esm/playwright/index.js",
      "require": "./dist/playwright/index.js"
    }
  },
  "sideEffects": ["./dist/cypress/support.js", "./dist/esm/cypress/support.js"],
  "scripts": {
    "build": "tsc -p tsconfig.json && tsc -p tsconfig.esm.json && node scripts/postbuild.mjs",
    "test:e2e": "npm run build && node e2e/run.mjs",
    "prepare": "npm run build"
  },
  "peerDependencies": {
    "@playwright/test": ">=1.40",
    "cypress": ">=13"
  },
  "peerDependenciesMeta": {
    "@playwright/test": { "optional": true },
    "cypress": { "optional": true }
  },
  "devDependencies": {
    "@playwright/test": "^1.50.0",
    "@types/node": "^20.0.0",
    "cypress": "^13.0.0",
    "typescript": "^5.0.0"
  }
}
```

`sdk/testing/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "es2020",
    "module": "node16",
    "moduleResolution": "node16",
    "declaration": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"],
  "exclude": ["src/**/__tests__", "dist", "node_modules"]
}
```

`sdk/testing/tsconfig.esm.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "module": "esnext", "moduleResolution": "bundler", "outDir": "dist/esm" }
}
```

`sdk/testing/scripts/postbuild.mjs`:

```js
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// dist/esm is plain .js emitted by tsc; without this marker Node would treat it
// as CommonJS because the package root has no "type": "module".
const here = dirname(fileURLToPath(import.meta.url))
const esm = resolve(here, '../dist/esm')
mkdirSync(esm, { recursive: true })
writeFileSync(resolve(esm, 'package.json'), '{"type":"module"}\n')
```

Append to `.gitignore` next to the other `sdk/` lines:

```
/sdk/testing/node_modules/
/sdk/testing/dist/
```

In `vitest.config.ts`, add one entry to the `node` project's `include` array (after `'scripts/__tests__/**/*.test.*'`):

```ts
            'sdk/testing/src/**/__tests__/**/*.test.*',
```

- [ ] **Step 2: Write the failing poll test**

`sdk/testing/src/__tests__/poll.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { poll, type Clock } from '../poll.js'
import { PibxTimeoutError } from '../errors.js'

function fakeClock(): Clock & { slept: number[] } {
  let t = 0
  const slept: number[] = []
  return {
    slept,
    now: () => t,
    sleep: async (ms) => {
      slept.push(ms)
      t += ms
    },
  }
}

describe('poll', () => {
  it('returns the value as soon as an attempt is done', async () => {
    const clock = fakeClock()
    let n = 0
    const value = await poll(
      async () => (++n < 3 ? { done: false as const } : { done: true as const, value: 'ok' }),
      { timeoutMs: 60_000, intervalMs: 2_000, describe: 'code', clock },
    )
    expect(value).toBe('ok')
    expect(n).toBe(3)
    expect(clock.slept).toEqual([2_000, 2_000])
  })

  it('makes exactly one attempt when timeoutMs is 0', async () => {
    const clock = fakeClock()
    let n = 0
    await expect(
      poll(async () => (n++, { done: false as const, lastStatus: 404 }), {
        timeoutMs: 0,
        intervalMs: 2_000,
        describe: 'code',
        clock,
      }),
    ).rejects.toBeInstanceOf(PibxTimeoutError)
    expect(n).toBe(1)
  })

  it('never sleeps past the deadline and reports the last status', async () => {
    const clock = fakeClock()
    const err = await poll(async () => ({ done: false as const, lastStatus: 404 }), {
      timeoutMs: 5_000,
      intervalMs: 2_000,
      describe: 'a code',
      clock,
    }).catch((e) => e)
    expect(err).toBeInstanceOf(PibxTimeoutError)
    expect(err.lastStatus).toBe(404)
    expect(err.message).toContain('a code')
    expect(clock.slept).toEqual([2_000, 2_000, 1_000])
  })

  it('honours retryAfterMs but is still capped by the deadline', async () => {
    const clock = fakeClock()
    await poll(async () => ({ done: false as const, lastStatus: 429, retryAfterMs: 30_000 }), {
      timeoutMs: 10_000,
      intervalMs: 2_000,
      describe: 'code',
      clock,
    }).catch(() => undefined)
    expect(clock.slept).toEqual([10_000])
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run --project node sdk/testing/src/__tests__/poll.test.ts`
Expected: FAIL — cannot resolve `../poll.js`.

- [ ] **Step 4: Implement errors and poll**

`sdk/testing/src/errors.ts`:

```ts
// None of these carry the request headers or the API key; status and path only.
export class PibxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

/** 401 or 403. Retrying cannot fix a bad or under-scoped key. */
export class PibxAuthError extends PibxError {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

/** Any other unexpected response, including a 200 whose body is not the contract shape. */
export class PibxHttpError extends PibxError {
  constructor(readonly status: number, readonly path: string, message: string) {
    super(message)
  }
}

export class PibxTimeoutError extends PibxError {
  constructor(message: string, readonly lastStatus: number | undefined) {
    super(message)
  }
}
```

`sdk/testing/src/poll.ts`:

```ts
import { PibxTimeoutError } from './errors.js'

export interface Clock {
  now(): number
  sleep(ms: number): Promise<void>
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

export type Attempt<T> =
  | { done: true; value: T }
  | { done: false; lastStatus?: number; retryAfterMs?: number }

/**
 * Always makes at least one attempt, so `timeoutMs: 0` means "check once".
 * Never sleeps past the deadline: the final sleep is shortened to what remains.
 */
export async function poll<T>(
  attempt: () => Promise<Attempt<T>>,
  opts: { timeoutMs: number; intervalMs: number; describe: string; clock?: Clock },
): Promise<T> {
  const clock = opts.clock ?? realClock
  const deadline = clock.now() + opts.timeoutMs

  for (;;) {
    const result = await attempt()
    if (result.done) return result.value

    const remaining = deadline - clock.now()
    if (remaining <= 0) {
      throw new PibxTimeoutError(
        `Timed out after ${opts.timeoutMs}ms waiting for ${opts.describe}`
          + (result.lastStatus === undefined ? '' : ` (last status ${result.lastStatus})`),
        result.lastStatus,
      )
    }
    const wanted = Math.max(opts.intervalMs, result.retryAfterMs ?? 0)
    await clock.sleep(Math.min(wanted, remaining))
  }
}
```

- [ ] **Step 5: Run to verify it passes, then commit**

Run: `npx vitest run --project node sdk/testing/src/__tests__/poll.test.ts`
Expected: PASS (4 tests).

```bash
git add sdk/testing .gitignore vitest.config.ts
git commit -m "feat(testing): scaffold @programmableinbox/testing with errors and poll loop"
```

---

### Task 2: Core client — `createInbox` and `waitForOtp`

**Files:**
- Create: `sdk/testing/test-support/stub-server.mjs`, `sdk/testing/src/client.ts`, `sdk/testing/src/index.ts`
- Test: `sdk/testing/src/__tests__/client.test.ts`

**Interfaces:**
- Consumes: `poll`, `Attempt`, `Clock` from `poll.ts`; error classes from `errors.ts`.
- Produces (`client.ts`):
  ```ts
  export interface Inbox { id: string; email: string; name: string | null; createdAt: string; [k: string]: unknown }
  export interface Message {
    id: string; subject: string | null; from: string; extractedOtp: string | null
    createdAt: string; [k: string]: unknown
  }
  export interface ClientOptions { apiKey?: string; baseUrl?: string; fetch?: typeof fetch; clock?: Clock }
  export interface WaitOptions {
    inboxId: string; since: Date | string; from?: string
    timeoutMs?: number; pollIntervalMs?: number
  }
  export interface WaitForMessageOptions extends WaitOptions { subject?: string }
  export interface PibxClient {
    createInbox(input: { email: string; name?: string }): Promise<Inbox>
    waitForOtp(input: WaitOptions): Promise<{ otp: string; message: Message }>
    waitForMessage(input: WaitForMessageOptions): Promise<Message>   // Task 3
  }
  export function createPibxClient(options?: ClientOptions): PibxClient
  ```
  In this task `waitForMessage` is declared on the interface but implemented in Task 3; the object literal omits it, so declare the return type as `Omit<PibxClient, 'waitForMessage'>` internally until Task 3, or implement a stub that throws `new Error('not implemented')` — use the stub and delete it in Task 3.

- [ ] **Step 1: Write the stub server**

`sdk/testing/test-support/stub-server.mjs`:

```js
import { createServer } from 'node:http'

/**
 * A minimal stand-in for the PIBX v1 endpoints the package calls.
 * `routes` maps "METHOD /path" to (req, url, body) => { status, body?, headers? }.
 * Every request is recorded in `requests` so tests can assert on headers and
 * query strings exactly as a real server would have seen them.
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
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}
```

- [ ] **Step 2: Write the failing client tests**

`sdk/testing/src/__tests__/client.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { startStub } from '../../test-support/stub-server.mjs'
import { createPibxClient } from '../client.js'
import { PibxAuthError, PibxHttpError, PibxTimeoutError } from '../errors.js'

type Stub = Awaited<ReturnType<typeof startStub>>
let stub: Stub | undefined
afterEach(async () => {
  await stub?.close()
  stub = undefined
})

const KEY = 'sk_live_supersecretkey'
const otpBody = (otp: string, createdAt: string) => ({
  data: { otp, message: { id: 'm1', subject: 'Your code', from: 'noreply@openai.com', extractedOtp: otp, createdAt } },
})
const fast = { pollIntervalMs: 5, timeoutMs: 400 }

describe('createPibxClient', () => {
  it('throws at construction when no key is available, naming the variable', () => {
    const prev = process.env.PIBX_API_KEY
    delete process.env.PIBX_API_KEY
    try {
      expect(() => createPibxClient()).toThrow(/PIBX_API_KEY/)
    } finally {
      if (prev !== undefined) process.env.PIBX_API_KEY = prev
    }
  })
})

describe('createInbox', () => {
  it('POSTs the address and returns the inbox', async () => {
    stub = await startStub({
      'POST /api/v1/emailInbox': () => ({
        status: 201,
        body: { data: { id: 'inbx_1', email: 'qa@x.dev', name: 'QA', createdAt: '2026-10-11T00:00:00Z' } },
      }),
    })
    const client = createPibxClient({ apiKey: KEY, baseUrl: stub.url })
    const inbox = await client.createInbox({ email: 'qa@x.dev', name: 'QA' })
    expect(inbox.id).toBe('inbx_1')
    expect(stub.requests[0].body).toEqual({ email: 'qa@x.dev', name: 'QA' })
    expect(stub.requests[0].headers.authorization).toBe(`Bearer ${KEY}`)
  })
})

describe('waitForOtp', () => {
  it('polls through 404s and returns the code with its message', async () => {
    let n = 0
    stub = await startStub({
      'GET /api/v1/emailInbox/inbx_1/otp': () =>
        ++n < 3
          ? { status: 404, body: { message: 'No OTP' } }
          : { status: 200, body: otpBody('424242', '2026-10-11T10:00:05Z') },
    })
    const client = createPibxClient({ apiKey: KEY, baseUrl: stub.url })
    const res = await client.waitForOtp({
      inboxId: 'inbx_1',
      since: '2026-10-11T10:00:00Z',
      from: 'openai.com',
      ...fast,
    })
    expect(res.otp).toBe('424242')
    expect(res.message.id).toBe('m1')
    expect(n).toBe(3)
    expect(stub.requests[0].query).toMatchObject({ from: 'openai.com', withinMinutes: '15' })
  })

  it('skips a stale code older than `since` and keeps waiting for a fresh one', async () => {
    let n = 0
    stub = await startStub({
      'GET /api/v1/emailInbox/inbx_1/otp': () =>
        ++n < 3
          ? { status: 200, body: otpBody('111111', '2026-10-11T09:00:00Z') }
          : { status: 200, body: otpBody('222222', '2026-10-11T10:00:09Z') },
    })
    const client = createPibxClient({ apiKey: KEY, baseUrl: stub.url })
    const res = await client.waitForOtp({ inboxId: 'inbx_1', since: new Date('2026-10-11T10:00:00Z'), ...fast })
    expect(res.otp).toBe('222222')
  })

  it('rejects an unparseable since immediately, without a request', async () => {
    stub = await startStub({})
    const client = createPibxClient({ apiKey: KEY, baseUrl: stub.url })
    await expect(client.waitForOtp({ inboxId: 'inbx_1', since: 'yesterday', ...fast })).rejects.toThrow(TypeError)
    await expect(client.waitForOtp({ inboxId: 'inbx_1', since: '', ...fast })).rejects.toThrow(TypeError)
    expect(stub.requests).toHaveLength(0)
  })

  it('does not retry on 401/403', async () => {
    stub = await startStub({ 'GET /api/v1/emailInbox/inbx_1/otp': () => ({ status: 403, body: { message: 'nope' } }) })
    const client = createPibxClient({ apiKey: KEY, baseUrl: stub.url })
    await expect(client.waitForOtp({ inboxId: 'inbx_1', since: new Date(0), ...fast })).rejects.toBeInstanceOf(
      PibxAuthError,
    )
    expect(stub.requests).toHaveLength(1)
  })

  it('times out with PibxTimeoutError carrying the last status', async () => {
    stub = await startStub({ 'GET /api/v1/emailInbox/inbx_1/otp': () => ({ status: 404, body: {} }) })
    const client = createPibxClient({ apiKey: KEY, baseUrl: stub.url })
    const err = await client
      .waitForOtp({ inboxId: 'inbx_1', since: new Date(0), pollIntervalMs: 5, timeoutMs: 40 })
      .catch((e) => e)
    expect(err).toBeInstanceOf(PibxTimeoutError)
    expect(err.lastStatus).toBe(404)
  })

  it('keeps a path prefix and ignores a trailing slash on baseUrl', async () => {
    stub = await startStub({
      'GET /pibx/api/v1/emailInbox/inbx_1/otp': () => ({ status: 200, body: otpBody('1', '2026-10-11T10:00:01Z') }),
    })
    const client = createPibxClient({ apiKey: KEY, baseUrl: `${stub.url}/pibx/` })
    await client.waitForOtp({ inboxId: 'inbx_1', since: '2026-10-11T10:00:00Z', ...fast })
    expect(stub.requests[0].path).toBe('/pibx/api/v1/emailInbox/inbx_1/otp')
  })

  it('percent-encodes the inbox id into the path', async () => {
    stub = await startStub({
      'GET /api/v1/emailInbox/a%2Fb%3Fc/otp': () => ({ status: 200, body: otpBody('1', '2026-10-11T10:00:01Z') }),
    })
    const client = createPibxClient({ apiKey: KEY, baseUrl: stub.url })
    await client.waitForOtp({ inboxId: 'a/b?c', since: '2026-10-11T10:00:00Z', ...fast })
    expect(stub.requests[0].path).toBe('/api/v1/emailInbox/a%2Fb%3Fc/otp')
  })

  it('turns a 200 with a non-contract body into PibxHttpError', async () => {
    stub = await startStub({
      'GET /api/v1/emailInbox/inbx_1/otp': () => ({ status: 200, body: '<html>Bad gateway</html>' }),
    })
    const client = createPibxClient({ apiKey: KEY, baseUrl: stub.url })
    await expect(client.waitForOtp({ inboxId: 'inbx_1', since: new Date(0), ...fast })).rejects.toBeInstanceOf(
      PibxHttpError,
    )
  })

  it('never puts the API key in an error', async () => {
    stub = await startStub({ 'GET /api/v1/emailInbox/inbx_1/otp': () => ({ status: 401, body: { message: 'bad' } }) })
    const client = createPibxClient({ apiKey: KEY, baseUrl: stub.url })
    const err = await client.waitForOtp({ inboxId: 'inbx_1', since: new Date(0), ...fast }).catch((e) => e)
    expect(String(err.message)).not.toContain(KEY)
    expect(String(err.stack)).not.toContain(KEY)
  })

  it('retries a 429 and honours Retry-After seconds', async () => {
    let n = 0
    stub = await startStub({
      'GET /api/v1/emailInbox/inbx_1/otp': () =>
        ++n < 2
          ? { status: 429, headers: { 'retry-after': '0' }, body: { message: 'slow down' } }
          : { status: 200, body: otpBody('9', '2026-10-11T10:00:09Z') },
    })
    const client = createPibxClient({ apiKey: KEY, baseUrl: stub.url })
    const res = await client.waitForOtp({ inboxId: 'inbx_1', since: '2026-10-11T10:00:00Z', ...fast })
    expect(res.otp).toBe('9')
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run --project node sdk/testing/src/__tests__/client.test.ts`
Expected: FAIL — cannot resolve `../client.js`.

- [ ] **Step 4: Implement the client**

`sdk/testing/src/client.ts`:

```ts
import { PibxAuthError, PibxHttpError } from './errors.js'
import { poll, type Attempt, type Clock } from './poll.js'

export interface Inbox {
  id: string
  email: string
  name: string | null
  createdAt: string
  [k: string]: unknown
}

export interface Message {
  id: string
  subject: string | null
  from: string
  extractedOtp: string | null
  createdAt: string
  [k: string]: unknown
}

export interface ClientOptions {
  apiKey?: string
  baseUrl?: string
  fetch?: typeof fetch
  clock?: Clock
}

export interface WaitOptions {
  inboxId: string
  /** Messages created before this are ignored. Required: see the spec. */
  since: Date | string
  /** Substring of the From header. */
  from?: string
  timeoutMs?: number
  pollIntervalMs?: number
}

export interface WaitForMessageOptions extends WaitOptions {
  /** Substring of the subject. */
  subject?: string
}

export interface PibxClient {
  createInbox(input: { email: string; name?: string }): Promise<Inbox>
  waitForOtp(input: WaitOptions): Promise<{ otp: string; message: Message }>
  waitForMessage(input: WaitForMessageOptions): Promise<Message>
}

const DEFAULT_BASE_URL = 'https://app.programmableinbox.com'
const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_INTERVAL_MS = 2_000
const OTP_WINDOW_MINUTES = '15'

function sinceMs(since: Date | string): number {
  const ms = since instanceof Date ? since.getTime() : Date.parse(since)
  if (Number.isNaN(ms)) {
    throw new TypeError(
      `since must be a Date or an ISO-8601 timestamp, got ${JSON.stringify(String(since))}`,
    )
  }
  return ms
}

function retryAfterMs(res: Response): number | undefined {
  const raw = res.headers.get('retry-after')
  if (raw === null) return undefined
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined
}

export function createPibxClient(options: ClientOptions = {}): PibxClient {
  const apiKey = options.apiKey ?? process.env.PIBX_API_KEY
  if (!apiKey) {
    throw new Error(
      'PIBX API key is missing. Pass `apiKey` or set the PIBX_API_KEY environment variable.',
    )
  }
  const base = (options.baseUrl ?? process.env.PIBX_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const doFetch = options.fetch ?? fetch
  const clock = options.clock

  async function call(method: string, path: string, query?: Record<string, string>, body?: unknown) {
    const qs = query && Object.keys(query).length ? `?${new URLSearchParams(query)}` : ''
    return doFetch(`${base}${path}${qs}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }

  /** Reads `{ data }`, mapping every way that can go wrong to a typed error. */
  async function readData<T>(res: Response, path: string): Promise<T> {
    let json: unknown
    try {
      json = await res.json()
    } catch {
      throw new PibxHttpError(res.status, path, `PIBX ${path} returned ${res.status} with a non-JSON body`)
    }
    const data = (json as { data?: unknown } | null)?.data
    if (data === undefined || data === null) {
      throw new PibxHttpError(res.status, path, `PIBX ${path} returned ${res.status} without a data field`)
    }
    return data as T
  }

  function failure(res: Response, path: string): Error {
    if (res.status === 401 || res.status === 403) {
      return new PibxAuthError(
        res.status,
        `PIBX rejected the API key for ${path} (${res.status}). Check the key and that it has the `
          + 'email_messages:read scope.',
      )
    }
    return new PibxHttpError(res.status, path, `PIBX ${path} returned ${res.status}`)
  }

  /** Statuses worth another attempt before the deadline. */
  const retryable = (s: number) => s === 404 || s === 429 || s >= 500

  const intervals = (o: WaitOptions) => ({
    timeoutMs: o.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    intervalMs: o.pollIntervalMs ?? DEFAULT_INTERVAL_MS,
    clock,
  })

  return {
    async createInbox(input) {
      const path = '/api/v1/emailInbox'
      const res = await call('POST', path, undefined, input)
      if (!res.ok) throw failure(res, path)
      return readData<Inbox>(res, path)
    },

    async waitForOtp(input) {
      const cutoff = sinceMs(input.since)
      const path = `/api/v1/emailInbox/${encodeURIComponent(input.inboxId)}/otp`
      const query: Record<string, string> = { withinMinutes: OTP_WINDOW_MINUTES }
      if (input.from) query.from = input.from

      return poll<{ otp: string; message: Message }>(
        async (): Promise<Attempt<{ otp: string; message: Message }>> => {
          const res = await call('GET', path, query)
          if (res.ok) {
            const data = await readData<{ otp?: unknown; message?: Message }>(res, path)
            if (typeof data.otp !== 'string' || !data.message || typeof data.message.createdAt !== 'string') {
              throw new PibxHttpError(res.status, path, `PIBX ${path} returned an unexpected otp payload`)
            }
            // The endpoint returns the *latest* code in its window. One from an
            // earlier run looks identical to a fresh one, so compare timestamps.
            if (Date.parse(data.message.createdAt) >= cutoff) {
              return { done: true, value: { otp: data.otp, message: data.message } }
            }
            return { done: false, lastStatus: res.status }
          }
          if (!retryable(res.status)) throw failure(res, path)
          return { done: false, lastStatus: res.status, retryAfterMs: retryAfterMs(res) }
        },
        {
          ...intervals(input),
          describe: `a code${input.from ? ` from "${input.from}"` : ''} in inbox ${input.inboxId}`,
        },
      )
    },

    async waitForMessage() {
      throw new Error('not implemented') // replaced in Task 3
    },
  }
}
```

`sdk/testing/src/index.ts`:

```ts
export { createPibxClient } from './client.js'
export type {
  ClientOptions,
  Inbox,
  Message,
  PibxClient,
  WaitForMessageOptions,
  WaitOptions,
} from './client.js'
export { PibxAuthError, PibxError, PibxHttpError, PibxTimeoutError } from './errors.js'
```

- [ ] **Step 5: Run to verify it passes, then commit**

Run: `npx vitest run --project node sdk/testing/src/__tests__`
Expected: PASS (poll 4 + client 11).

```bash
git add sdk/testing
git commit -m "feat(testing): core client with createInbox and waitForOtp"
```

---

### Task 3: Core client — `waitForMessage`

**Files:**
- Modify: `sdk/testing/src/client.ts` (replace the stub `waitForMessage`)
- Test: `sdk/testing/src/__tests__/client.test.ts` (append a `describe`)

**Interfaces:**
- Consumes: `call`, `readData`, `failure`, `retryable`, `retryAfterMs`, `intervals`, `sinceMs`, `poll` — all already in `client.ts`.
- Produces: `waitForMessage(input: WaitForMessageOptions): Promise<Message>` — resolves with the **newest** message that has `createdAt >= since` and, if given, a `subject` containing the substring (case-insensitive).

- [ ] **Step 1: Append the failing tests**

Add to `sdk/testing/src/__tests__/client.test.ts`:

```ts
describe('waitForMessage', () => {
  const msg = (id: string, subject: string, createdAt: string) => ({
    id, subject, from: 'a@b.c', extractedOtp: null, createdAt,
  })

  it('returns the newest message at or after since matching the subject', async () => {
    stub = await startStub({
      'GET /api/v1/emailInbox/inbx_1/messages': () => ({
        status: 200,
        body: {
          data: {
            messages: [
              msg('new-other', 'Welcome', '2026-10-11T10:00:09Z'),
              msg('new-match', 'Reset your password', '2026-10-11T10:00:08Z'),
              msg('old-match', 'Reset your password', '2026-10-11T08:00:00Z'),
            ],
            nextCursor: null,
            hasMore: false,
          },
        },
      }),
    })
    const client = createPibxClient({ apiKey: KEY, baseUrl: stub.url })
    const m = await client.waitForMessage({
      inboxId: 'inbx_1',
      since: '2026-10-11T10:00:00Z',
      subject: 'RESET',
      from: 'openai.com',
      ...fast,
    })
    expect(m.id).toBe('new-match')
    expect(stub.requests[0].query).toMatchObject({ from: 'openai.com', limit: '50', grouped: 'false' })
  })

  it('keeps polling while nothing qualifies, then times out', async () => {
    stub = await startStub({
      'GET /api/v1/emailInbox/inbx_1/messages': () => ({
        status: 200,
        body: { data: { messages: [msg('old', 'x', '2026-10-11T08:00:00Z')], nextCursor: null, hasMore: false } },
      }),
    })
    const client = createPibxClient({ apiKey: KEY, baseUrl: stub.url })
    await expect(
      client.waitForMessage({ inboxId: 'inbx_1', since: '2026-10-11T10:00:00Z', pollIntervalMs: 5, timeoutMs: 40 }),
    ).rejects.toBeInstanceOf(PibxTimeoutError)
    expect(stub.requests.length).toBeGreaterThan(1)
  })

  it('rejects an unparseable since without a request', async () => {
    stub = await startStub({})
    const client = createPibxClient({ apiKey: KEY, baseUrl: stub.url })
    await expect(client.waitForMessage({ inboxId: 'inbx_1', since: 'nope', ...fast })).rejects.toThrow(TypeError)
    expect(stub.requests).toHaveLength(0)
  })

  it('turns a 200 without a messages array into PibxHttpError', async () => {
    stub = await startStub({
      'GET /api/v1/emailInbox/inbx_1/messages': () => ({ status: 200, body: { data: { messages: 'no' } } }),
    })
    const client = createPibxClient({ apiKey: KEY, baseUrl: stub.url })
    await expect(client.waitForMessage({ inboxId: 'inbx_1', since: new Date(0), ...fast })).rejects.toBeInstanceOf(
      PibxHttpError,
    )
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project node sdk/testing/src/__tests__/client.test.ts -t waitForMessage`
Expected: FAIL — `Error: not implemented`.

- [ ] **Step 3: Replace the stub**

In `sdk/testing/src/client.ts`, replace the stub method with:

```ts
    async waitForMessage(input) {
      const cutoff = sinceMs(input.since)
      const path = `/api/v1/emailInbox/${encodeURIComponent(input.inboxId)}/messages`
      // grouped=false: grouped mode collapses to one row per thread, which can
      // hide a newer reply inside a thread we already have a message from.
      const query: Record<string, string> = { limit: '50', grouped: 'false' }
      if (input.from) query.from = input.from
      const wantSubject = input.subject?.toLowerCase()

      return poll<Message>(
        async (): Promise<Attempt<Message>> => {
          const res = await call('GET', path, query)
          if (res.ok) {
            const data = await readData<{ messages?: unknown }>(res, path)
            if (!Array.isArray(data.messages)) {
              throw new PibxHttpError(res.status, path, `PIBX ${path} returned an unexpected messages payload`)
            }
            // The API returns newest first; take the first that qualifies.
            const hit = (data.messages as Message[]).find(
              (m) =>
                Date.parse(m.createdAt) >= cutoff
                && (wantSubject === undefined || (m.subject ?? '').toLowerCase().includes(wantSubject)),
            )
            return hit ? { done: true, value: hit } : { done: false, lastStatus: res.status }
          }
          if (!retryable(res.status)) throw failure(res, path)
          return { done: false, lastStatus: res.status, retryAfterMs: retryAfterMs(res) }
        },
        {
          ...intervals(input),
          describe: `a message${input.subject ? ` with subject containing "${input.subject}"` : ''} in inbox ${input.inboxId}`,
        },
      )
    },
```

Also update the 403 message in `failure()` — it names `email_messages:read`, which is correct for both endpoints, so no change is needed there.

- [ ] **Step 4: Run to verify it passes, then commit**

Run: `npx vitest run --project node sdk/testing/src/__tests__`
Expected: PASS (all tests).

```bash
git add sdk/testing
git commit -m "feat(testing): waitForMessage with subject and since filtering"
```

---

### Task 4: Cypress adapter

**Files:**
- Create: `sdk/testing/src/cypress/index.ts`, `sdk/testing/src/cypress/support.ts`
- Test: `sdk/testing/src/__tests__/cypress.test.ts`

**Interfaces:**
- Consumes: `createPibxClient`, `Inbox`, `Message`, `ClientOptions` from `../client.js`.
- Produces (`cypress/index.ts`):
  ```ts
  export interface PibxCypressConfig { env: Record<string, unknown> }
  export function pibxTasks(
    on: (event: 'task', tasks: Record<string, (arg: any) => unknown>) => void,
    config: PibxCypressConfig,
    options?: { fetch?: typeof fetch },
  ): void
  ```
  Tasks registered: `pibx:now` → ISO string; `pibx:createInbox` (`{email, name?}`) → `Inbox`; `pibx:waitForOtp` (`WaitOptions` with `since: string`) → the **otp string**; `pibx:waitForMessage` (`WaitForMessageOptions`) → `Message`. No task ever returns `undefined` (Cypress rejects it).
- Produces (`cypress/support.ts`): commands `cy.pibxNow()`, `cy.pibxWaitForOtp(opts)` (yields the code string), `cy.pibxWaitForMessage(opts)` (yields the message), `cy.pibxCreateInbox(input)`.

- [ ] **Step 1: Write the failing test**

`sdk/testing/src/__tests__/cypress.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { startStub } from '../../test-support/stub-server.mjs'
import { pibxTasks } from '../cypress/index.js'

type Stub = Awaited<ReturnType<typeof startStub>>
let stub: Stub | undefined
afterEach(async () => {
  await stub?.close()
  stub = undefined
})

function register(config: { env: Record<string, unknown> }) {
  let tasks: Record<string, (arg: any) => unknown> = {}
  pibxTasks((_event, t) => { tasks = t }, config)
  return tasks
}

describe('pibxTasks', () => {
  it('registers the four tasks', () => {
    const tasks = register({ env: { PIBX_API_KEY: 'sk_live_x' } })
    expect(Object.keys(tasks).sort()).toEqual([
      'pibx:createInbox',
      'pibx:now',
      'pibx:waitForMessage',
      'pibx:waitForOtp',
    ])
  })

  it('pibx:now returns an ISO timestamp, never undefined', async () => {
    const tasks = register({ env: { PIBX_API_KEY: 'sk_live_x' } })
    const now = await tasks['pibx:now'](null)
    expect(Date.parse(now as string)).not.toBeNaN()
  })

  it('reads key and base URL from config.env and returns just the code string', async () => {
    stub = await startStub({
      'GET /api/v1/emailInbox/inbx_1/otp': () => ({
        status: 200,
        body: { data: { otp: '135790', message: { id: 'm', subject: 's', from: 'f', extractedOtp: '135790', createdAt: '2099-01-01T00:00:00Z' } } },
      }),
    })
    const tasks = register({ env: { PIBX_API_KEY: 'sk_live_cfg', PIBX_BASE_URL: stub.url } })
    const code = await tasks['pibx:waitForOtp']({
      inboxId: 'inbx_1',
      since: '2026-01-01T00:00:00Z',
      pollIntervalMs: 5,
      timeoutMs: 200,
    })
    expect(code).toBe('135790')
    expect(stub.requests[0].headers.authorization).toBe('Bearer sk_live_cfg')
  })

  it('defers the missing-key error to the first task call, not config load', async () => {
    const prev = process.env.PIBX_API_KEY
    delete process.env.PIBX_API_KEY
    try {
      const tasks = register({ env: {} }) // must not throw: cypress.config.ts is loaded for every command
      await expect(Promise.resolve().then(() => tasks['pibx:waitForOtp']({ inboxId: 'i', since: new Date(0).toISOString() }))).rejects.toThrow(/PIBX_API_KEY/)
    } finally {
      if (prev !== undefined) process.env.PIBX_API_KEY = prev
    }
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project node sdk/testing/src/__tests__/cypress.test.ts`
Expected: FAIL — cannot resolve `../cypress/index.js`.

- [ ] **Step 3: Implement the Node half**

`sdk/testing/src/cypress/index.ts`:

```ts
import { createPibxClient, type PibxClient, type WaitForMessageOptions, type WaitOptions } from '../client.js'

export interface PibxCypressConfig {
  env: Record<string, unknown>
}

type OnTask = (event: 'task', tasks: Record<string, (arg: any) => unknown>) => void

const asString = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined)

/**
 * Call from `setupNodeEvents(on, config)`. The client is built lazily on the
 * first task call: `cypress.config.ts` is evaluated for every Cypress command,
 * including ones that never touch PIBX, and a missing key must not break those.
 */
export function pibxTasks(on: OnTask, config: PibxCypressConfig, options: { fetch?: typeof fetch } = {}): void {
  let client: PibxClient | undefined
  const get = () =>
    (client ??= createPibxClient({
      // config.env carries cypress.env.json and CYPRESS_* variables. Falling
      // through to undefined lets the core client consult process.env.
      apiKey: asString(config.env.PIBX_API_KEY),
      baseUrl: asString(config.env.PIBX_BASE_URL),
      fetch: options.fetch,
    }))

  on('task', {
    'pibx:now': () => new Date().toISOString(),
    'pibx:createInbox': (input: { email: string; name?: string }) => get().createInbox(input),
    // Yields the bare code: it is what a spec types into a field. A task must
    // return a value other than undefined, which this always does or throws.
    'pibx:waitForOtp': async (input: WaitOptions) => (await get().waitForOtp(input)).otp,
    'pibx:waitForMessage': (input: WaitForMessageOptions) => get().waitForMessage(input),
  })
}
```

- [ ] **Step 4: Implement the browser half**

`sdk/testing/src/cypress/support.ts`:

```ts
// Browser-side. Must not import the core client or anything that touches
// node:* or process — Cypress bundles this file for the browser.

type PibxWaitArgs = {
  inboxId: string
  /** ISO timestamp from cy.pibxNow(). Codes from earlier messages are ignored. */
  since: string
  from?: string
  timeoutMs?: number
  pollIntervalMs?: number
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    // Must keep Cypress's own type parameter list so declaration merging applies.
    interface Chainable<Subject = any> {
      /** The current time as an ISO string, from the Node process. Call before triggering the email. */
      pibxNow(): Chainable<string>
      /** Claims an inbox address. Addresses are permanent; do not call this per test. */
      pibxCreateInbox(input: { email: string; name?: string }): Chainable<{ id: string; email: string }>
      /** Yields the code string. */
      pibxWaitForOtp(args: PibxWaitArgs): Chainable<string>
      /** Yields the newest matching message. */
      pibxWaitForMessage(args: PibxWaitArgs & { subject?: string }): Chainable<Record<string, unknown>>
    }
  }
}

// cy.task has its own 60s default timeout. Give it headroom over our poll
// deadline so a longer wait is not cut short by Cypress rather than by us.
const DEFAULT_TIMEOUT_MS = 60_000
const HEADROOM_MS = 10_000

const g = globalThis as unknown as { Cypress: any; cy: any }

g.Cypress.Commands.add('pibxNow', () => g.cy.task('pibx:now', null, { log: false }))

g.Cypress.Commands.add('pibxCreateInbox', (input: { email: string; name?: string }) =>
  g.cy.task('pibx:createInbox', input),
)

g.Cypress.Commands.add('pibxWaitForOtp', (args: PibxWaitArgs) =>
  g.cy.task('pibx:waitForOtp', args, { timeout: (args.timeoutMs ?? DEFAULT_TIMEOUT_MS) + HEADROOM_MS }),
)

g.Cypress.Commands.add('pibxWaitForMessage', (args: PibxWaitArgs & { subject?: string }) =>
  g.cy.task('pibx:waitForMessage', args, { timeout: (args.timeoutMs ?? DEFAULT_TIMEOUT_MS) + HEADROOM_MS }),
)

export {}
```

- [ ] **Step 5: Run to verify it passes, build, commit**

Run: `npx vitest run --project node sdk/testing/src/__tests__/cypress.test.ts`
Expected: PASS (4 tests).

Run: `cd sdk/testing && npm install && npm run build`
Expected: exits 0; `dist/cypress/index.js`, `dist/cypress/support.d.ts`, and `dist/esm/package.json` exist.

```bash
git add sdk/testing
git commit -m "feat(testing): Cypress tasks and support commands"
```

---

### Task 5: Playwright adapter

**Files:**
- Create: `sdk/testing/src/playwright/index.ts`
- Test: `sdk/testing/src/__tests__/playwright.test.ts`

**Interfaces:**
- Consumes: `createPibxClient`, `PibxClient` from `../client.js`.
- Produces:
  ```ts
  export interface PibxFixtures { pibx: PibxClient; pibxApiKey: string | undefined; pibxBaseUrl: string | undefined }
  export const pibxFixtures: Fixtures<PibxFixtures>   // type from '@playwright/test'
  ```
  Usage: `export const test = base.extend<PibxFixtures>(pibxFixtures)`.

- [ ] **Step 1: Write the failing test**

`sdk/testing/src/__tests__/playwright.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { startStub } from '../../test-support/stub-server.mjs'
import { pibxFixtures } from '../playwright/index.js'

type Stub = Awaited<ReturnType<typeof startStub>>
let stub: Stub | undefined
afterEach(async () => {
  await stub?.close()
  stub = undefined
})

// Playwright fixtures are [value, options] tuples for options and plain async
// functions for fixtures. Exercise the function directly with a fake `use`.
async function resolvePibx(deps: { pibxApiKey?: string; pibxBaseUrl?: string }) {
  let value: any
  await (pibxFixtures.pibx as any)(deps, async (v: unknown) => { value = v })
  return value
}

describe('pibxFixtures', () => {
  it('declares the key and base URL as options defaulting to undefined', () => {
    expect(pibxFixtures.pibxApiKey).toEqual([undefined, { option: true }])
    expect(pibxFixtures.pibxBaseUrl).toEqual([undefined, { option: true }])
  })

  it('builds a client from the option fixtures', async () => {
    stub = await startStub({
      'POST /api/v1/emailInbox': () => ({ status: 201, body: { data: { id: 'inbx_9', email: 'e@x.dev', name: null, createdAt: 'z' } } }),
    })
    const pibx = await resolvePibx({ pibxApiKey: 'sk_live_pw', pibxBaseUrl: stub.url })
    const inbox = await pibx.createInbox({ email: 'e@x.dev' })
    expect(inbox.id).toBe('inbx_9')
    expect(stub.requests[0].headers.authorization).toBe('Bearer sk_live_pw')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project node sdk/testing/src/__tests__/playwright.test.ts`
Expected: FAIL — cannot resolve `../playwright/index.js`.

- [ ] **Step 3: Implement**

`sdk/testing/src/playwright/index.ts`:

```ts
import type { Fixtures } from '@playwright/test'
import { createPibxClient, type PibxClient } from '../client.js'

export interface PibxFixtures {
  /** The core client, configured from the option fixtures or PIBX_* env vars. */
  pibx: PibxClient
  pibxApiKey: string | undefined
  pibxBaseUrl: string | undefined
}

/**
 * Plain object so it composes: `test.extend<PibxFixtures>(pibxFixtures)`, or
 * `mergeTests` with a user's own fixtures. Test-scoped; the client is
 * stateless, so there is nothing to tear down and no inbox is created or
 * deleted behind the user's back.
 */
export const pibxFixtures: Fixtures<PibxFixtures> = {
  pibxApiKey: [undefined, { option: true }],
  pibxBaseUrl: [undefined, { option: true }],
  pibx: async ({ pibxApiKey, pibxBaseUrl }, use) => {
    await use(createPibxClient({ apiKey: pibxApiKey, baseUrl: pibxBaseUrl }))
  },
}
```

- [ ] **Step 4: Run to verify it passes, build, commit**

Run: `npx vitest run --project node sdk/testing/src/__tests__/playwright.test.ts`
Expected: PASS (2 tests). The test imports the module, whose only `@playwright/test` import is `import type`, so root `node_modules` need not contain Playwright.

Run: `cd sdk/testing && npm run build`
Expected: exits 0.

```bash
git add sdk/testing
git commit -m "feat(testing): Playwright fixtures"
```

---

### Task 6: Real-framework smoke tests

**Files:**
- Create: `sdk/testing/e2e/run.mjs`, `sdk/testing/e2e/cypress.config.ts`, `sdk/testing/e2e/cypress/support/e2e.ts`, `sdk/testing/e2e/cypress/e2e/otp.cy.ts`, `sdk/testing/e2e/playwright.config.ts`, `sdk/testing/e2e/otp.spec.ts`

These run the **built** package (`dist/`) under the real `cypress run` and `playwright test`, the only thing that catches registration mistakes (a missing export-map entry, a support file that pulls in a Node module). They are a package-local script, `npm run test:e2e`, not part of root `npm test`, because they need the Cypress binary.

**Interfaces:**
- Consumes: the built `@programmableinbox/testing` via a relative path to `dist/`, so no `npm link` is needed.
- Produces: `node e2e/run.mjs` exit code 0 only if both frameworks pass.

- [ ] **Step 1: Write the runner**

`sdk/testing/e2e/run.mjs`:

```js
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startStub } from '../test-support/stub-server.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const now = new Date().toISOString()

const stub = await startStub({
  'GET /api/v1/emailInbox/inbx_e2e/otp': () => ({
    status: 200,
    body: {
      data: {
        otp: '314159',
        message: { id: 'm', subject: 'Your code', from: 'noreply@openai.com', extractedOtp: '314159', createdAt: new Date(Date.now() + 60_000).toISOString() },
      },
    },
  }),
})

const env = { ...process.env, PIBX_API_KEY: 'sk_live_e2e', PIBX_BASE_URL: stub.url, E2E_SINCE: now }
let failed = false
for (const [label, cmd, args] of [
  ['cypress', 'npx', ['cypress', 'run', '--config-file', 'e2e/cypress.config.ts']],
  ['playwright', 'npx', ['playwright', 'test', '-c', 'e2e/playwright.config.ts']],
]) {
  console.log(`\n==> ${label}`)
  const r = spawnSync(cmd, args, { cwd: root, env, stdio: 'inherit' })
  if (r.status !== 0) failed = true
}
await stub.close()
process.exit(failed ? 1 : 0)
```

- [ ] **Step 2: Cypress smoke test**

`sdk/testing/e2e/cypress.config.ts`:

```ts
import { defineConfig } from 'cypress'
import { pibxTasks } from '../dist/cypress/index.js'

export default defineConfig({
  e2e: {
    specPattern: 'e2e/cypress/e2e/**/*.cy.ts',
    supportFile: 'e2e/cypress/support/e2e.ts',
    video: false,
    screenshotOnRunFailure: false,
    setupNodeEvents(on, config) {
      // Same shape a user writes: cypress.env.json / CYPRESS_* land in config.env.
      config.env.PIBX_API_KEY = process.env.PIBX_API_KEY
      config.env.PIBX_BASE_URL = process.env.PIBX_BASE_URL
      pibxTasks(on, config)
      return config
    },
  },
})
```

`sdk/testing/e2e/cypress/support/e2e.ts`:

```ts
import '../../../dist/cypress/support.js'
```

`sdk/testing/e2e/cypress/e2e/otp.cy.ts`:

```ts
describe('@programmableinbox/testing under real Cypress', () => {
  it('yields the code string through cy.pibxWaitForOtp', () => {
    cy.pibxNow().then((since) => {
      cy.pibxWaitForOtp({ inboxId: 'inbx_e2e', since, from: 'openai.com', timeoutMs: 5000, pollIntervalMs: 50 })
        .should('equal', '314159')
    })
  })
})
```

- [ ] **Step 3: Playwright smoke test**

`sdk/testing/e2e/playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'otp.spec.ts',
  reporter: 'line',
})
```

`sdk/testing/e2e/otp.spec.ts`:

```ts
import { test as base, expect } from '@playwright/test'
import { pibxFixtures, type PibxFixtures } from '../dist/playwright/index.js'

const test = base.extend<PibxFixtures>(pibxFixtures)

test('returns the code through the pibx fixture', async ({ pibx }) => {
  const { otp } = await pibx.waitForOtp({
    inboxId: 'inbx_e2e',
    since: process.env.E2E_SINCE!,
    from: 'openai.com',
    timeoutMs: 5000,
    pollIntervalMs: 50,
  })
  expect(otp).toBe('314159')
})
```

- [ ] **Step 4: Run it**

Run: `cd sdk/testing && npm install && npx cypress install && npm run test:e2e`
Expected: both `==> cypress` and `==> playwright` report passing; exit code 0.

If Cypress fails with *"Cannot find module '../dist/cypress/index.js'"*, run `npm run build` first (`test:e2e` does this already; the message means the build failed).

- [ ] **Step 5: Commit**

```bash
git add sdk/testing/e2e
git commit -m "test(testing): real Cypress and Playwright smoke tests"
```

---

### Task 7: Repo wiring, README and guide

**Files:**
- Modify: `eslint.config.mjs` (allowlist), `lib/config/__tests__/no-raw-env.test.ts` (allowlist), `sdk/README.md`, `docs/guides/cypress-chatgpt-login.md`
- Create: `sdk/testing/README.md`

**Interfaces:** none new. This task makes the package a first-class citizen of the repo's gates and rewrites the guide to use it.

- [ ] **Step 1: Allow `process.env` in the package**

The package is a separate publishable artifact that cannot import `lib/config`, so it reads `process.env` itself. In `eslint.config.mjs`, add to the allowlist block that ends `'**/__tests__/**'`:

```js
      // Separate publishable package: runs in the user's test process, so it
      // cannot import the app's lib/config. It reads PIBX_API_KEY/PIBX_BASE_URL.
      'sdk/testing/**',
```

In `lib/config/__tests__/no-raw-env.test.ts`, add after `/^test\//,`:

```ts
  /^sdk\/testing\//,
```

- [ ] **Step 2: Verify the gates**

Run: `npm run lint -- sdk/testing && npx vitest run --project node lib/config/__tests__/no-raw-env.test.ts`
Expected: lint clean; `no-raw-env` PASS. If `no-raw-env` still fails, it lists the offending file; compare its path against the regex you added.

- [ ] **Step 3: Write the package README**

`sdk/testing/README.md` — sections, with the code from Tasks 2–5 as the examples: install (`npm i -D @programmableinbox/testing`), required key scopes (`email_messages:read`; `email_inboxes:create` only for one-time setup), env vars, a Cypress quick start (the `pibxTasks` line in `cypress.config.ts`, the one-line support import, and `cy.pibxNow()` then `cy.pibxWaitForOtp(...)`), a Playwright quick start (`base.extend<PibxFixtures>(pibxFixtures)`), and a "Gotchas" list: inbox addresses are permanent so never create per test; `since` is required and comes from a clock on the machine running the test, so keep it close to NTP time; `openai`/`chatgpt` are blocked in local parts. Link to `docs/guides/cypress-chatgpt-login.md`.

- [ ] **Step 4: Add the package to `sdk/README.md`**

Add one row to the language table:

```md
| TypeScript (test helpers) | [`testing/`](testing/README.md) | `@programmableinbox/testing` |
```

and one sentence under the table: *"`testing/` is hand-written, not generated, and is not touched by `npm run sdk:generate`."*

- [ ] **Step 5: Shrink the guide**

In `docs/guides/cypress-chatgpt-login.md`: replace the whole step-3 `cypress.config.ts` block with the `pibxTasks(on, config)` form, replace the `cy.task('pibx:now')` / `cy.task('pibx:waitForOtp')` calls in step 4 with `cy.pibxNow()` / `cy.pibxWaitForOtp(...)`, add `import '@programmableinbox/testing/cypress/support'` to the support-file step, and delete the "what changes once the package ships" note. Keep the "Read this first" and troubleshooting sections unchanged. Add `npm i -D @programmableinbox/testing` to Prerequisites, and note that until it is published to npm, a checkout can use `npm i -D ./sdk/testing` or `npm link`.

- [ ] **Step 6: Run the full suite (CLAUDE.md pre-PR requirement) and commit**

Run: `npm run test`
Expected: PASS, with the test count higher than before (the new `sdk/testing` tests are included via the `node` project).

```bash
git add eslint.config.mjs lib/config/__tests__/no-raw-env.test.ts sdk/README.md sdk/testing/README.md docs/guides/cypress-chatgpt-login.md
git commit -m "docs(testing): README, repo gates, and guide now uses the package"
```

---

## Self-review

- **Spec coverage:** core API (Tasks 1–3), env defaults and key-missing throw (Task 2), required `since` (Task 2), typed errors and retry policy (Tasks 1–2), Cypress Node + browser halves with type augmentation and task-timeout headroom (Task 4), Playwright fixtures with option fixtures and `mergeTests` shape (Task 5), unit tests against a `node:http` stub and one smoke test per framework (Tasks 2–6), layout under `sdk/testing` outside `generate.sh` (Task 1, 7), open questions 4 (429 → retry + `Retry-After`, Task 1/2) and 5 (Cypress `>=13` as peer floor, Task 1). **Gaps, deliberately:** the `.test-d.ts` for `Chainable` augmentation is covered by building `support.ts` with `tsc` in Task 4 plus the real-Cypress smoke test, since the root `typecheck` project is scoped to `lib/**`; and the release job is out of scope (stated in the File Structure section).
- **Placeholders:** none; Task 7 step 3 and step 5 describe prose edits to docs and enumerate exactly what goes in them.
- **Type consistency:** `WaitOptions`, `WaitForMessageOptions`, `Attempt`, `Clock`, `PibxClient` and the four task names are used identically across Tasks 1–6. `pibx:waitForOtp` returns a string in the task and in `cy.pibxWaitForOtp`, while the core `waitForOtp` returns `{ otp, message }`; Task 4 documents that on purpose.
