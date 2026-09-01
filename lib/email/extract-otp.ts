/**
 * Regex-only OTP/PIN/verification-code extraction, replacing what used to be
 * an LLM prompt instruction. Two keyword tiers, because a bare "code" is one
 * of the most common false-positive triggers in real mail (zip code, promo
 * code, discount code, source code) — it only counts as a signal when tightly
 * connected to a token via a colon/equals/hyphen or "is"/"was", never merely
 * nearby. The compound phrases below ("verification code", "security code",
 * ...) are unambiguous enough to use a looser connector.
 */
const STRONG_KEYWORDS =
  /(one[- ]?time password|verification code|security code|confirmation code|access code|authentication code|auth code|login code|passcode|pass code|\botp\b)/gi
const WEAK_KEYWORDS = /(\bcode\b|\bpin\b)/gi

const LOOSE_CONNECTOR = /^[\s]*(?:is|was)?[\s:=-]*/i
const STRICT_CONNECTOR = /^[\s]*(?:is|was|[:=-])[\s:=-]*/i
const TOKEN = /^[A-Za-z0-9]{4,10}\b/
// "123456 is your verification code" — the code precedes the keyword, with
// "is your"/"is the"/"is my" between them. Common enough (Google, Microsoft,
// Amazon all send this shape) to be worth a dedicated backward check.
const BACKWARD_PATTERN = /([A-Za-z0-9]{4,10})\s+(?:is|was)\s+(?:your|the|my|a\b)?\s*$/i

const FORWARD_WINDOW = 40
const BACKWARD_WINDOW = 40

export function extractOtp(bodyText: string | null | undefined): string | null {
  if (!bodyText) return null

  for (const keywordMatch of bodyText.matchAll(STRONG_KEYWORDS)) {
    const idx = keywordMatch.index ?? 0
    const forward = forwardToken(bodyText, idx + keywordMatch[0].length, LOOSE_CONNECTOR)
    if (forward) return forward
    const backward = backwardToken(bodyText, idx)
    if (backward) return backward
  }

  for (const keywordMatch of bodyText.matchAll(WEAK_KEYWORDS)) {
    const idx = keywordMatch.index ?? 0
    const forward = forwardToken(bodyText, idx + keywordMatch[0].length, STRICT_CONNECTOR)
    if (forward) return forward
  }

  return null
}

function forwardToken(text: string, from: number, connector: RegExp): string | null {
  const remainder = text.slice(from, from + FORWARD_WINDOW)
  const connectorMatch = connector.exec(remainder)
  const start = connectorMatch ? connectorMatch[0].length : 0
  const tokenMatch = TOKEN.exec(remainder.slice(start))
  return tokenMatch && /\d/.test(tokenMatch[0]) ? tokenMatch[0] : null
}

function backwardToken(text: string, upTo: number): string | null {
  const window = text.slice(Math.max(0, upTo - BACKWARD_WINDOW), upTo)
  const match = BACKWARD_PATTERN.exec(window)
  return match && /\d/.test(match[1]) ? match[1] : null
}
