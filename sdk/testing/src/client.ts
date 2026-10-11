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
   * A boundary for `since`, as an ISO string: the server's time (HTTP `Date`
   * header, one-second precision) moved just past the newest mail already in the
   * inbox, so mail from earlier in the same second is never mistaken for fresh.
   * Server-side on both counts, so a skewed local clock can't drop a fresh code.
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
const MESSAGES_PAGE_SIZE = '50'
/** Backstop on one poll attempt's paging: 20 pages is 1000 messages newer than `since`. */
const MAX_PAGES_PER_ATTEMPT = 20
const READ_SCOPE = 'email_messages:read'
const CREATE_SCOPE = 'email_inboxes:create'

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

  /** The server's `{ message }` explanation, if the body has one. Never throws. */
  async function serverMessage(res: Response): Promise<string | undefined> {
    try {
      const body = (await res.clone().json()) as { message?: unknown } | null
      return typeof body?.message === 'string' ? body.message : undefined
    } catch {
      return undefined
    }
  }

  function failure(res: Response, path: string, message?: string, scope: string = READ_SCOPE): Error {
    if (res.status === 401 || res.status === 403) {
      return new PibxAuthError(
        res.status,
        `PIBX rejected the API key for ${path} (${res.status}). Check the key and that it has the `
          + `${scope} scope.`,
      )
    }
    return new PibxHttpError(
      res.status,
      path,
      `PIBX ${path} returned ${res.status}${message ? `: ${message}` : ''}`,
    )
  }

  /**
   * The server answers the *same* 404 status for "no such inbox" and for "no
   * code yet", and tells them apart only in the body. Retrying the first for a
   * minute (after `otpAfter` has already fired a real email) just hides a typo
   * in the inbox id behind a timeout.
   */
  const NOT_FOUND_MESSAGE = 'Not found'
  const inboxNotFound = (path: string) =>
    new PibxHttpError(
      404,
      path,
      `PIBX ${path} says the inbox was not found. Check the inbox id (PIBX_INBOX_ID) `
        + 'and that the API key belongs to the same organization.',
    )

  /** Statuses worth another attempt before the deadline. */
  const retryable = (s: number) => s === 404 || s === 429 || s >= 500

  /** A non-2xx inside a poll: throw if retrying cannot help, else a not-done result. */
  async function notOk(res: Response, path: string): Promise<Attempt<never>> {
    const message = await serverMessage(res)
    if (res.status === 404 && message === NOT_FOUND_MESSAGE) throw inboxNotFound(path)
    if (!retryable(res.status)) throw failure(res, path, message)
    return { done: false, lastStatus: res.status, lastMessage: message, retryAfterMs: retryAfterMs(res) }
  }

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
            return {
              done: false,
              lastStatus: res.status,
              lastMessage:
                `the newest code (created ${data.message.createdAt}) is older than since `
                + `(${new Date(cutoff).toISOString()}); no new mail has arrived yet`,
            }
          }
          return notOk(res, path)
        }),
      {
        ...pollOptions(input),
        describe: `a code${input.from ? ` from "${input.from}"` : ''} in inbox ${inboxId}`,
      },
    )
  }

  /** Rejects a version-skewed or malformed element before it can reach `.find` as a TypeError. */
  function parseMessages(raw: unknown, status: number, path: string): Message[] {
    const bad = (why: string) =>
      new PibxHttpError(status, path, `PIBX ${path} returned an unexpected messages payload (${why})`)
    if (!Array.isArray(raw)) throw bad('messages is not an array')
    raw.forEach((m, i) => {
      if (typeof m !== 'object' || m === null) throw bad(`messages[${i}] is not an object`)
      const { createdAt, subject } = m as { createdAt?: unknown; subject?: unknown }
      if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) {
        throw bad(`messages[${i}].createdAt is not a timestamp`)
      }
      if (subject !== null && subject !== undefined && typeof subject !== 'string') {
        throw bad(`messages[${i}].subject is not a string`)
      }
    })
    return raw as Message[]
  }

  async function waitForMessage(input: WaitForMessageOptions): Promise<Message> {
    const cutoff = sinceMs(input.since)
    const inboxId = resolveInbox(input.inboxId)
    const path = `/api/v1/emailInbox/${encodeURIComponent(inboxId)}/messages`
    // grouped=false: grouped mode collapses to one row per thread, which can
    // hide a newer reply inside a thread we already have a message from.
    const baseQuery: Record<string, string> = { limit: MESSAGES_PAGE_SIZE, grouped: 'false' }
    if (input.from) baseQuery.from = input.from
    const wantSubject = input.subject?.toLowerCase()

    return poll<Message>(
      (remaining) =>
        guarded(async (): Promise<Attempt<Message>> => {
          // Newest first, so paging can stop at the first mail older than `since`:
          // a match beyond the first page is otherwise never inspected.
          let cursor: string | undefined
          let inspected = 0
          let lastStatus = 200
          for (let page = 0; page < MAX_PAGES_PER_ATTEMPT; page++) {
            const query = cursor === undefined ? baseQuery : { ...baseQuery, cursor }
            const res = await call('GET', path, requestBudget(remaining), query)
            if (!res.ok) return notOk(res, path)
            lastStatus = res.status
            const data = await readData<{ messages?: unknown; nextCursor?: unknown; hasMore?: unknown }>(res, path)
            const messages = parseMessages(data.messages, res.status, path)
            inspected += messages.length
            const hit = messages.find(
              (m) =>
                Date.parse(m.createdAt) >= cutoff
                && (wantSubject === undefined || (m.subject ?? '').toLowerCase().includes(wantSubject)),
            )
            if (hit) return { done: true, value: hit }
            const oldest = messages[messages.length - 1]
            const reachedOlderMail = oldest !== undefined && Date.parse(oldest.createdAt) < cutoff
            if (reachedOlderMail || data.hasMore !== true || typeof data.nextCursor !== 'string') break
            cursor = data.nextCursor
          }
          return {
            done: false,
            lastStatus,
            lastMessage:
              `${inspected} message(s) found, none created at or after `
              + `${new Date(cutoff).toISOString()} that match`,
          }
        }),
      {
        ...pollOptions(input),
        describe: `a message${input.subject ? ` with subject containing "${input.subject}"` : ''} in inbox ${inboxId}`,
      },
    )
  }

  async function serverNow(inboxId?: string): Promise<string> {
    const path = `/api/v1/emailInbox/${encodeURIComponent(resolveInbox(inboxId))}/messages`
    // Newest message, not just the clock: the HTTP `Date` header has one-second
    // precision, so mail created earlier in that same second would otherwise
    // satisfy `createdAt >= since` and be returned as fresh. Same scope as every
    // wait (email_messages:read).
    const res = await callOnce('GET', path, { limit: '1', grouped: 'false' })
    if (res.status === 401 || res.status === 403) throw failure(res, path)
    // Fail here, before the caller's trigger fires a real email at a typo'd id.
    if (res.status === 404 && (await serverMessage(res)) === NOT_FOUND_MESSAGE) {
      throw inboxNotFound(path)
    }
    const header = res.headers.get('date')
    const dateMs = header === null ? Number.NaN : Date.parse(header)
    if (Number.isNaN(dateMs)) {
      // Deliberately not a fallback to the local clock: skew is what this removes.
      throw new PibxHttpError(res.status, path, `PIBX ${path} response had no usable Date header`)
    }
    return new Date(Math.max(dateMs, (await newestCreatedAtMs(res)) + 1)).toISOString()
  }

  /** The newest message's createdAt in ms, or -Infinity when there is none or the body is unusable. */
  async function newestCreatedAtMs(res: Response): Promise<number> {
    if (!res.ok) return Number.NEGATIVE_INFINITY
    try {
      const body = (await res.json()) as { data?: { messages?: Array<{ createdAt?: unknown }> } } | null
      const createdAt = body?.data?.messages?.[0]?.createdAt
      const ms = typeof createdAt === 'string' ? Date.parse(createdAt) : Number.NaN
      return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms
    } catch {
      return Number.NEGATIVE_INFINITY
    }
  }

  return {
    async createInbox(input) {
      const path = '/api/v1/emailInbox'
      const res = await callOnce('POST', path, undefined, input)
      if (!res.ok) throw failure(res, path, await serverMessage(res), CREATE_SCOPE)
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
