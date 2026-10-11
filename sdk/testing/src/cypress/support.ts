// Browser-side. Must not import the core client or anything that touches
// node:* or process — Cypress bundles this file for the browser.

type PibxWaitArgs = {
  /** Falls back to PIBX_INBOX_ID. */
  inboxId?: string
  /** ISO timestamp from cy.pibxNow(). Messages created earlier are ignored. */
  since: string
  /** Substring of the From header, e.g. "openai.com". */
  from?: string
  timeoutMs?: number
  pollIntervalMs?: number
}

type PibxAfterArgs = Omit<PibxWaitArgs, 'since'> & {
  /**
   * Runs after server time is read and before waiting: put the action that
   * sends the email here. Use Cypress commands only (no promises).
   */
  after?: () => void
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    // Must keep Cypress's own type parameter list so declaration merging applies.
    interface Chainable<Subject = any> {
      /** The PIBX server's current time (ISO). Call before triggering the email. */
      pibxNow(args?: { inboxId?: string }): Chainable<string>
      /** Claims an inbox address. Addresses are permanent; do not call this per test. */
      pibxCreateInbox(input: { email: string; name?: string }): Chainable<{ id: string; email: string }>
      /**
       * The easy path: reads server time, runs `after`, waits, and yields the
       * code string. You never handle `since`.
       */
      pibxOtp(args?: PibxAfterArgs): Chainable<string>
      /** Low-level: yields the code string for messages created at or after `since`. */
      pibxWaitForOtp(args: PibxWaitArgs): Chainable<string>
      /** Low-level: yields the newest matching message. */
      pibxWaitForMessage(args: PibxWaitArgs & { subject?: string }): Chainable<Record<string, unknown>>
    }
  }
}

// cy.task has its own 60s default timeout. Give it headroom over our poll
// deadline so a longer wait is not cut short by Cypress rather than by us.
const DEFAULT_TIMEOUT_MS = 60_000
const HEADROOM_MS = 10_000
const taskTimeout = (args: { timeoutMs?: number }) => (args.timeoutMs ?? DEFAULT_TIMEOUT_MS) + HEADROOM_MS

const g = globalThis as unknown as { Cypress: any; cy: any }

g.Cypress.Commands.add('pibxNow', (args?: { inboxId?: string }) =>
  g.cy.task('pibx:now', args ?? null, { log: false }),
)

g.Cypress.Commands.add('pibxCreateInbox', (input: { email: string; name?: string }) =>
  g.cy.task('pibx:createInbox', input),
)

g.Cypress.Commands.add('pibxOtp', (args: PibxAfterArgs = {}) => {
  const { after, ...rest } = args
  return g.cy.task('pibx:now', { inboxId: rest.inboxId }, { log: false }).then((since: string) => {
    if (after) after()
    return g.cy.task('pibx:waitForOtp', { ...rest, since }, { timeout: taskTimeout(rest) })
  })
})

g.Cypress.Commands.add('pibxWaitForOtp', (args: PibxWaitArgs) =>
  g.cy.task('pibx:waitForOtp', args, { timeout: taskTimeout(args) }),
)

g.Cypress.Commands.add('pibxWaitForMessage', (args: PibxWaitArgs & { subject?: string }) =>
  g.cy.task('pibx:waitForMessage', args, { timeout: taskTimeout(args) }),
)

export {}
