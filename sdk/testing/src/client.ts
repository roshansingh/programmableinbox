import { PibxAuthError, PibxError, PibxHttpError } from './errors.js'
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
  /** Defaults to the PIBX_API_KEY environment variable. */
  apiKey?: string
  /** Defaults to PIBX_BASE_URL, then https://app.programmableinbox.com. */
  baseUrl?: string
  /** Default inbox for every call. Defaults to PIBX_INBOX_ID. */
  inboxId?: string
  /** Default poll interval in ms (positive integer). Defaults to PIBX_POLL_INTERVAL_MS, then 5000. */
  pollIntervalMs?: number
  /** Ceiling for a single HTTP request in ms. Default 15000. */
  requestTimeoutMs?: number
  fetch?: typeof fetch
  clock?: Clock
}

export interface WaitOptions {
  /** Falls back to the client's `inboxId`, then PIBX_INBOX_ID. */
  inboxId?: string
  /** Messages created before this are ignored. Required: see the spec. */
  since: Date | string
  /** Substring of the From header. */
  from?: string
  timeoutMs?: number
  pollIntervalMs?: number
}

export interface WaitForMessageOptions extends WaitOptions {
  /** Substring of the subject, case-insensitive. */
  subject?: string
}

export type AfterOptions = Omit<WaitOptions, 'since'>
export type MessageAfterOptions = Omit<WaitForMessageOptions, 'since'>

export interface PibxClient {
  createInbox(input: { email: string; name?: string }): Promise<Inbox>
  waitForOtp(input: WaitOptions): Promise<{ otp: string; message: Message }>
  waitForMessage(input: WaitForMessageOptions): Promise<Message>
  /**
   * The PIBX server's current time as an ISO string, read from an HTTP `Date`
   * header. Use it for `since` so a skewed local clock can't drop a fresh code.
   */
  serverNow(inboxId?: string): Promise<string>
  /** Reads server time, runs `trigger`, then waits for a code newer than that time. */
  otpAfter(
    trigger: () => unknown | Promise<unknown>,
    options?: AfterOptions,
  ): Promise<{ otp: string; message: Message }>
  /** Like `otpAfter`, for any message. */
  messageAfter(trigger: () => unknown | Promise<unknown>, options?: MessageAfterOptions): Promise<Message>
}

const DEFAULT_BASE_URL = 'https://app.programmableinbox.com'
const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_INTERVAL_MS = 5_000
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
/** A request is always allowed this long, so `timeoutMs: 0` still gets a real check. */
const MIN_REQUEST_MS = 1_000
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

function assertPositiveInt(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer number of milliseconds`)
  }
  return value
}

/** Option wins over the environment, which wins over the default. Set-but-invalid throws. */
function resolveDefaultInterval(explicit: number | undefined): number {
  if (explicit !== undefined) return assertPositiveInt(explicit, 'pollIntervalMs')
  const raw = process.env.PIBX_POLL_INTERVAL_MS
  if (raw === undefined || raw.trim() === '') return DEFAULT_INTERVAL_MS
  return assertPositiveInt(Number(raw), 'PIBX_POLL_INTERVAL_MS')
}

function retryAfterMs(res: Response): number | undefined {
  const raw = res.headers.get('retry-after')
  if (raw === null) return undefined
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined
}

/** True for failures a later attempt could plausibly get past: timeouts and network errors. */
function isTransientNetworkError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  return e.name === 'TimeoutError' || e.name === 'AbortError' || e instanceof TypeError
}

function describeError(e: unknown): string {
  if (!(e instanceof Error)) return String(e)
  const code = (e as { cause?: { code?: unknown } }).cause?.code
  return typeof code === 'string' ? `${e.message} (${code})` : e.message
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
  const defaultInterval = resolveDefaultInterval(options.pollIntervalMs)
  const requestTimeoutMs = assertPositiveInt(
    options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    'requestTimeoutMs',
  )

  function resolveInbox(explicit?: string): string {
    const id = explicit || options.inboxId || process.env.PIBX_INBOX_ID
    if (!id) {
      throw new Error(
        'No inbox id. Pass `inboxId`, set it on the client, or set the PIBX_INBOX_ID environment variable.',
      )
    }
    return id
  }

  async function call(
    method: string,
    path: string,
    timeoutMs: number,
    query?: Record<string, string>,
    body?: unknown,
  ) {
    const qs = query && Object.keys(query).length ? `?${new URLSearchParams(query)}` : ''
    return doFetch(`${base}${path}${qs}`, {
      method,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }

  /** One-shot request (outside a poll loop): a network failure becomes a typed error. */
  async function callOnce(
    method: string,
    path: string,
    query?: Record<string, string>,
    body?: unknown,
  ): Promise<Response> {
    try {
      return await call(method, path, requestTimeoutMs, query, body)
    } catch (e) {
      if (isTransientNetworkError(e)) {
        throw new PibxHttpError(0, path, `PIBX ${path} request failed: ${describeError(e)}`)
      }
      throw e
    }
  }

  /** Reads `{ data }`, mapping every way that can go wrong to a typed error. */
  async function readData<T>(res: Response, path: string): Promise<T> {
    let json: unknown
    try {
      json = await res.json()
    } catch (e) {
      // A body read cut off by the request timeout is retryable; bad JSON is not.
      if (isTransientNetworkError(e)) throw e
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

  /** Maps a transient network failure inside an attempt to a retryable result. */
  async function guarded<T>(run: () => Promise<Attempt<T>>): Promise<Attempt<T>> {
    try {
      return await run()
    } catch (e) {
      if (e instanceof PibxError || !isTransientNetworkError(e)) throw e
      return { done: false, lastError: describeError(e) }
    }
  }

  const requestBudget = (remainingMs: number) =>
    Math.min(requestTimeoutMs, Math.max(remainingMs, MIN_REQUEST_MS))

  const pollOptions = (o: { timeoutMs?: number; pollIntervalMs?: number }) => ({
    timeoutMs: o.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    intervalMs: o.pollIntervalMs !== undefined ? assertPositiveInt(o.pollIntervalMs, 'pollIntervalMs') : defaultInterval,
    clock,
  })

  const otpPath = (inboxId: string) => `/api/v1/emailInbox/${encodeURIComponent(inboxId)}/otp`

  async function waitForOtp(input: WaitOptions): Promise<{ otp: string; message: Message }> {
    const cutoff = sinceMs(input.since)
    const inboxId = resolveInbox(input.inboxId)
    const path = otpPath(inboxId)
    const query: Record<string, string> = { withinMinutes: OTP_WINDOW_MINUTES }
    if (input.from) query.from = input.from

    return poll<{ otp: string; message: Message }>(
      (remaining) =>
        guarded(async (): Promise<Attempt<{ otp: string; message: Message }>> => {
          const res = await call('GET', path, requestBudget(remaining), query)
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
        }),
      {
        ...pollOptions(input),
        describe: `a code${input.from ? ` from "${input.from}"` : ''} in inbox ${inboxId}`,
      },
    )
  }

  async function waitForMessage(input: WaitForMessageOptions): Promise<Message> {
    const cutoff = sinceMs(input.since)
    const inboxId = resolveInbox(input.inboxId)
    const path = `/api/v1/emailInbox/${encodeURIComponent(inboxId)}/messages`
    // grouped=false: grouped mode collapses to one row per thread, which can
    // hide a newer reply inside a thread we already have a message from.
    const query: Record<string, string> = { limit: '50', grouped: 'false' }
    if (input.from) query.from = input.from
    const wantSubject = input.subject?.toLowerCase()

    return poll<Message>(
      (remaining) =>
        guarded(async (): Promise<Attempt<Message>> => {
          const res = await call('GET', path, requestBudget(remaining), query)
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
        }),
      {
        ...pollOptions(input),
        describe: `a message${input.subject ? ` with subject containing "${input.subject}"` : ''} in inbox ${inboxId}`,
      },
    )
  }

  async function serverNow(inboxId?: string): Promise<string> {
    const path = otpPath(resolveInbox(inboxId))
    // The OTP endpoint, not the list endpoint: it needs only email_messages:read,
    // the scope every wait already requires. Any answer carries a Date header.
    const res = await callOnce('GET', path, { withinMinutes: '1' })
    if (res.status === 401 || res.status === 403) throw failure(res, path)
    const header = res.headers.get('date')
    const ms = header === null ? Number.NaN : Date.parse(header)
    if (Number.isNaN(ms)) {
      // Deliberately not a fallback to the local clock: skew is what this removes.
      throw new PibxHttpError(res.status, path, `PIBX ${path} response had no usable Date header`)
    }
    return new Date(ms).toISOString()
  }

  return {
    async createInbox(input) {
      const path = '/api/v1/emailInbox'
      const res = await callOnce('POST', path, undefined, input)
      if (!res.ok) throw failure(res, path)
      return readData<Inbox>(res, path)
    },
    waitForOtp,
    waitForMessage,
    serverNow,
    async otpAfter(trigger, opts = {}) {
      const since = await serverNow(opts.inboxId)
      await trigger()
      return waitForOtp({ ...opts, since })
    },
    async messageAfter(trigger, opts = {}) {
      const since = await serverNow(opts.inboxId)
      await trigger()
      return waitForMessage({ ...opts, since })
    },
  }
}
