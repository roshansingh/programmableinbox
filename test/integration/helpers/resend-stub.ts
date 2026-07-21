// test/integration/helpers/resend-stub.ts
import type { Mock } from 'vitest'

export interface ResendMocks {
  send: Mock          // emails.send  — outbound send path
  verify: Mock        // webhooks.verify — Svix signature check (throw to simulate a bad sig)
  receivingGet: Mock  // emails.receiving.get — inbound body fetch
}

/** Build the fake getResend() return value from the provided mock fns. */
export function resendClient(m: ResendMocks) {
  return {
    emails: { send: m.send, receiving: { get: m.receivingGet } },
    webhooks: { verify: m.verify },
  }
}
