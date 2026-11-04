import { requireSms } from '@/lib/config'
import { SmsProviderError } from './errors'
import { callTwilio } from './twilio-client'
import type { SmsCountry } from './validation'

export type { SmsCountry }

export type AvailableNumber = {
  phoneNumber: string
  locality: string | null
  region: string | null
}

export type PurchasedNumber = {
  sid: string
  phoneNumber: string
  capabilities: { sms: boolean; mms: boolean; voice: boolean }
}

/** Twilio caps a search page at its own limit; 20 is plenty for a pick list. */
const SEARCH_LIMIT = 20

/** Where Twilio posts inbound SMS. Built in `purchaseNumber`; the route lands in #142. */
const WEBHOOK_PATH = '/api/webhooks/sms'

/**
 * Local, SMS-capable numbers in `areaCode`. The caller validates the area code
 * (three digits); it reaches Twilio as a number, which is what the SDK takes.
 */
export async function searchAvailableNumbers(
  country: SmsCountry,
  areaCode: string,
): Promise<AvailableNumber[]> {
  const found = await callTwilio((client) =>
    client.availablePhoneNumbers(country).local.list({
      areaCode: Number(areaCode),
      smsEnabled: true,
      limit: SEARCH_LIMIT,
    }),
  )

  return found.map((n) => ({
    phoneNumber: n.phoneNumber,
    locality: n.locality || null,
    region: n.region || null,
  }))
}

/**
 * Buys `phoneNumber` and points its inbound-SMS webhook at this deployment.
 *
 * The URL is built from `APP_BASE_URL`, never from a request: Twilio signs the
 * exact URL it posts to, so verification must be able to rebuild the same string
 * from operator configuration alone. Trailing slashes are trimmed so a base of
 * `https://x.test/` does not become `https://x.test//api/webhooks/sms`, which
 * would sign differently from the URL we later check against.
 *
 * Spends real money. Callers reserve the number first (see
 * `lib/services/phone-provisioning.ts`) so two requests cannot both reach here
 * for one number.
 */
export async function purchaseNumber(phoneNumber: string): Promise<PurchasedNumber> {
  const { appBaseUrl } = requireSms()
  const smsUrl = `${appBaseUrl.replace(/\/+$/, '')}${WEBHOOK_PATH}`

  const bought = await callTwilio((client) =>
    client.incomingPhoneNumbers.create({ phoneNumber, smsUrl, smsMethod: 'POST' }),
  )

  // Rebuilt rather than returned: the SDK instance carries the account SID and
  // other fields that have no business reaching a database row or a log line.
  return {
    sid: bought.sid,
    phoneNumber: bought.phoneNumber,
    capabilities: {
      sms: Boolean(bought.capabilities?.sms),
      mms: Boolean(bought.capabilities?.mms),
      voice: Boolean(bought.capabilities?.voice),
    },
  }
}

/**
 * Hands a purchased number back to Twilio, which stops the monthly charge.
 *
 * A number Twilio no longer has counts as released: the goal state already
 * holds, and refusing would leave a row that can never be deleted. Every other
 * failure rethrows so the caller keeps the row and the delete can be retried.
 */
export async function releaseNumber(sid: string): Promise<void> {
  try {
    await callTwilio((client) => client.incomingPhoneNumbers(sid).remove())
  } catch (error) {
    if (error instanceof SmsProviderError && error.kind === 'not-found') return
    throw error
  }
}
