import type { Fixtures } from '@playwright/test'
import { createPibxClient, type PibxClient } from '../client.js'

export interface PibxFixtures {
  /** The core client, configured from the option fixtures or PIBX_* env vars. */
  pibx: PibxClient
  pibxApiKey: string | undefined
  pibxBaseUrl: string | undefined
  /** Default inbox for `pibx.otpAfter` and friends. Falls back to PIBX_INBOX_ID. */
  pibxInboxId: string | undefined
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
  pibxInboxId: [undefined, { option: true }],
  pibx: async ({ pibxApiKey, pibxBaseUrl, pibxInboxId }, use) => {
    await use(createPibxClient({ apiKey: pibxApiKey, baseUrl: pibxBaseUrl, inboxId: pibxInboxId }))
  },
}
