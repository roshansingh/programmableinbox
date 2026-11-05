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
 * Whether `phoneNumber` is, right now, in `country`'s SMS-capable local inventory.
 *
 * This is the server-side eligibility check a purchase must pass. Syntax cannot
 * establish it: `+1` also covers toll-free, premium and Caribbean numbers, none
 * of which the product sells, and the country label is client-supplied. Asking
 * the same inventory the search dialog draws from ties the label to the number
 * and keeps a hand-built request to the numbers a user could have picked.
 *
 * `contains` is anchored with a trailing `$` (Twilio's "match the end" meta
 * character) on the ten-digit national number, so it holds whether Twilio
 * matches against national digits or E.164, and the result is still compared
 * for an exact match.
 */
export async function isNumberAvailable(country: SmsCountry, phoneNumber: string): Promise<boolean> {
  const national = phoneNumber.replace(/^\+1/, '')
  const found = await callTwilio((client) =>
    client.availablePhoneNumbers(country).local.list({
      contains: `${national}$`,
      smsEnabled: true,
      limit: 5,
    }),
  )
  return found.some((n) => n.phoneNumber === phoneNumber)
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
 * The sid of `phoneNumber` if this account holds it, else null.
 *
 * For recovering from a purchase whose answer was lost: Twilio may have sold the
 * number and billed for it while we never learned its sid. Safe to act on only
 * while the caller holds the reservation for that number, because the live-number
 * index means nobody else can legitimately own it in the meantime.
 */
export async function findOwnedNumberSid(phoneNumber: string): Promise<string | null> {
  const found = await callTwilio((client) =>
    client.incomingPhoneNumbers.list({ phoneNumber, limit: 1 }),
  )
  return found[0]?.sid ?? null
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
