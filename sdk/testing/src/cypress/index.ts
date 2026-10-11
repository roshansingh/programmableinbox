import {
  createPibxClient,
  type PibxClient,
  type WaitForMessageOptions,
  type WaitOptions,
} from '../client.js'

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
  const get = () => {
    if (client) return client
    const rawInterval = config.env.PIBX_POLL_INTERVAL_MS
    const interval = rawInterval === undefined || rawInterval === '' ? undefined : Number(rawInterval)
    if (interval !== undefined && (!Number.isInteger(interval) || interval < 1)) {
      // Name the variable the user actually set, not the client option it maps to.
      throw new RangeError('PIBX_POLL_INTERVAL_MS must be a positive integer number of milliseconds')
    }
    client = createPibxClient({
      // config.env carries cypress.env.json and CYPRESS_* variables. Falling
      // through to undefined lets the core client consult process.env.
      apiKey: asString(config.env.PIBX_API_KEY),
      baseUrl: asString(config.env.PIBX_BASE_URL),
      inboxId: asString(config.env.PIBX_INBOX_ID),
      // Cypress coerces numeric env values, so this may arrive as a number.
      pollIntervalMs: interval,
      fetch: options.fetch,
    })
    return client
  }

  on('task', {
    // Server time, not the test machine's clock: see PibxClient.serverNow.
    'pibx:now': (input: { inboxId?: string } | null) => get().serverNow(input?.inboxId),
    'pibx:createInbox': (input: { email: string; name?: string }) => get().createInbox(input),
    // Yields the bare code: it is what a spec types into a field. A task must
    // return a value other than undefined, which this always does or throws.
    'pibx:waitForOtp': async (input: WaitOptions) => (await get().waitForOtp(input)).otp,
    'pibx:waitForMessage': (input: WaitForMessageOptions) => get().waitForMessage(input),
  })
}
