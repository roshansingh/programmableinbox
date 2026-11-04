/** Countries a number can be bought in (epic #139: US and CA only). */
export const SMS_COUNTRIES = ['US', 'CA'] as const
export type SmsCountry = (typeof SMS_COUNTRIES)[number]

export function isSmsCountry(value: unknown): value is SmsCountry {
  return typeof value === 'string' && (SMS_COUNTRIES as readonly string[]).includes(value)
}

/** E.164: a plus, then 8–15 digits with no leading zero. No spaces or punctuation. */
const E164_PATTERN = /^\+[1-9]\d{7,14}$/

export function isE164(value: unknown): value is string {
  return typeof value === 'string' && E164_PATTERN.test(value)
}

/**
 * A North American Numbering Plan number: `+1`, then an area code and exchange
 * that each start 2–9. US and Canada share it, which is why this — not just
 * "E.164" — is what a purchase must satisfy: epic #139 sells US and CA numbers
 * only, and the platform account may be permitted to buy elsewhere.
 */
const NANP_PATTERN = /^\+1[2-9]\d{2}[2-9]\d{6}$/

export function isNanpNumber(value: unknown): value is string {
  return typeof value === 'string' && NANP_PATTERN.test(value)
}

/** A North American area code: exactly three digits. */
export function isAreaCode(value: unknown): value is string {
  return typeof value === 'string' && /^\d{3}$/.test(value)
}
