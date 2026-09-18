/**
 * Regex-only OTP/PIN/verification-code extraction (`extractOtp`), replacing
 * what used to be an LLM prompt instruction. It runs at ingestion and is the
 * source of truth; the LLM is consulted only as a fallback when it returns
 * null, and that answer must pass `acceptLlmOtp` (bottom of this file) before
 * it is stored. Two keyword tiers, because a bare "code" is one
 * of the most common false-positive triggers in real mail (zip code, promo
 * code, discount code, source code) — it only counts as a signal when tightly
 * connected to a token via a colon/equals/hyphen or "is"/"was", never merely
 * nearby. The compound phrases below ("verification code", "security code",
 * ...) are unambiguous enough to use a looser connector.
 *
 * The weak tier ("code"/"pin" alone) is additionally restricted to
 * digits-only tokens and guarded by a disqualifying-prefix check (promo,
 * zip, discount, coupon, referral, ...), since real mail routinely pairs a
 * bare "code" with an alphanumeric marketing token (SAVE20, SPRING25) that
 * is not an OTP. The strong tier keeps accepting alphanumeric tokens, since
 * "verification code" etc. is unambiguous.
 *
 * The word-boundary fix on is/was prevents the connector from swallowing part
 * of a following word (e.g. "code islander42" no longer parses "is" out of
 * "islander"), but a token immediately after the keyword that happens to
 * contain a digit can still false-positive on the STRONG tier's loose
 * (whitespace-only) connector — this is an accepted heuristic tradeoff, not
 * something this fix eliminates entirely.
 */
const STRONG_KEYWORDS =
  /(one[- ]?time password|verification code|security code|confirmation code|access code|authentication code|auth code|login code|passcode|pass code|\botp\b)/gi
const WEAK_KEYWORDS = /(\bcode\b|\bpin\b)/gi

const LOOSE_CONNECTOR = /^[\s]*(?:is\b|was\b)?[\s:=-]*/i
const STRICT_CONNECTOR = /^[\s]*(?:is\b|was\b|[:=-])[\s:=-]*/i
const TOKEN = /^[A-Za-z0-9]{4,10}\b/
const DIGIT_TOKEN = /^\d{4,10}\b/
// "123456 is your verification code" — the code precedes the keyword, with
// "is your"/"is the"/"is my" between them. Common enough (Google, Microsoft,
// Amazon all send this shape) to be worth a dedicated backward check.
const BACKWARD_PATTERN = /([A-Za-z0-9]{4,10})\s+(?:is|was)\b\s+(?:your|the|my|a\b)?\s*$/i

// Shared with the LLM fallback gate (acceptLlmOtp below), so both are held to
// one list of "this token is not a one-time code" context rather than two
// that drift.
const DISQUALIFYING_TERMS =
  'zip|postal|area|promo|coupon|discount|referral|tracking|country|error|status|source'
const DISQUALIFYING_PREFIX = new RegExp(`\\b(?:${DISQUALIFYING_TERMS})\\s*$`, 'i')
const PREFIX_WINDOW = 20

const FORWARD_WINDOW = 40
const BACKWARD_WINDOW = 40

export function extractOtp(bodyText: string | null | undefined): string | null {
  if (!bodyText) return null

  for (const keywordMatch of bodyText.matchAll(STRONG_KEYWORDS)) {
    const idx = keywordMatch.index ?? 0
    const forward = forwardToken(bodyText, idx + keywordMatch[0].length, LOOSE_CONNECTOR, TOKEN)
    if (forward) return forward
    const backward = backwardToken(bodyText, idx)
    if (backward) return backward
  }

  for (const keywordMatch of bodyText.matchAll(WEAK_KEYWORDS)) {
    const idx = keywordMatch.index ?? 0
    if (isDisqualified(bodyText, idx)) continue
    const forward = forwardToken(bodyText, idx + keywordMatch[0].length, STRICT_CONNECTOR, DIGIT_TOKEN)
    if (forward) return forward
  }

  return null
}

function forwardToken(text: string, from: number, connector: RegExp, tokenPattern: RegExp): string | null {
  const remainder = text.slice(from, from + FORWARD_WINDOW)
  const connectorMatch = connector.exec(remainder)
  const start = connectorMatch ? connectorMatch[0].length : 0
  const tokenMatch = tokenPattern.exec(remainder.slice(start))
  return tokenMatch && /\d/.test(tokenMatch[0]) ? tokenMatch[0] : null
}

function isDisqualified(text: string, keywordStart: number): boolean {
  const before = text.slice(Math.max(0, keywordStart - PREFIX_WINDOW), keywordStart)
  return DISQUALIFYING_PREFIX.test(before)
}

function backwardToken(text: string, upTo: number): string | null {
  const window = text.slice(Math.max(0, upTo - BACKWARD_WINDOW), upTo)
  const match = BACKWARD_PATTERN.exec(window)
  return match && /\d/.test(match[1]) ? match[1] : null
}

// ---------------------------------------------------------------------------
// LLM fallback gate
// ---------------------------------------------------------------------------

// Same shape the regex tiers accept via TOKEN: 4-10 alphanumerics with at
// least one digit. Applied to the *whole* candidate, not the front of a window.
const LLM_OTP_FORMAT = /^[A-Za-z0-9]{4,10}$/
// A code an email prints as "123 456" or "12-34-56". At most one separator
// between two characters, so a match cannot stretch across unrelated text.
// (Whitespace runs are collapsed first, so a non-breaking space, a newline or
// a table cell per digit all arrive here as a single space.)
const LLM_OTP_SEPARATOR = '[ -]?'
// The model returns a phrase, not the email. Without a cap it could return the
// whole body, which would contain an OTP keyword *and* a promo word somewhere
// and make both evidence checks below meaningless.
const LLM_OTP_EVIDENCE_MAX_LENGTH = 200
// How far back from the code to look for a disqualifying word. Before only:
// "Promo: 123456" precedes its token, whereas text after a code is usually the
// next paragraph.
const LLM_OTP_CONTEXT_WINDOW = 30

// What a one-time-code sentence looks like. Deliberately not a bare "code":
// that is exactly the word a promo code shares, so it would make the check
// toothless. Like extractOtp()'s two tiers there are two strengths:
//  - strong: a word only ever used for these (OTP, passcode), or a qualifier
//    directly attached to the noun ("verification code", "sign-in token");
//  - loose: a qualifier and a noun merely somewhere in the same sentence
//    ("Enter code 482913 to sign in").
// A token with letters in it (SAVE20, SPRING25) is the shape of a marketing
// code, so it must clear the strong bar; a digits-only token may use either.
const OTP_QUALIFIERS =
  'verification|verify|security|confirmation|authentication|auth|log[- ]?in|sign[- ]?in|temporary|access|2fa|two[- ]factor|multi[- ]factor|one[- ]?time|single[- ]use'
const OTP_NOUNS = 'code|password|pin|token'
const OTP_SIGNAL_STANDALONE = /\b(?:otp|passcode|pass code)\b/i
const OTP_SIGNAL_QUALIFIER = new RegExp(`\\b(?:${OTP_QUALIFIERS})\\b`, 'i')
const OTP_SIGNAL_NOUN = new RegExp(`\\b(?:${OTP_NOUNS})\\b`, 'i')
const OTP_SIGNAL_COMPOUND = new RegExp(`\\b(?:${OTP_QUALIFIERS})[\\s-]+(?:${OTP_NOUNS})\\b`, 'i')

// Sentences that describe something other than an OTP even when they contain
// one of the words above ("promo code 123456 ... to verify your discount").
// Wider than the regex extractor's list because the model reads whole
// sentences, so it can be handed an order number or a percentage.
const EVIDENCE_DISQUALIFIERS = new RegExp(
  [
    '\\b(?:promo(?:tion(?:al)?)?|coupon|discount|voucher|referral|gift\\s?card|zip|postal|tracking|invoice)\\b',
    '\\b(?:order|reference|confirmation|account|booking|case|ticket)\\s*(?:number|no\\b|id\\b|#)',
    '%\\s*off\\b',
  ].join('|'),
  'i',
)
const DISQUALIFYING_NEARBY = new RegExp(`\\b(?:${DISQUALIFYING_TERMS})\\b`, 'i')

const collapseWhitespace = (text: string) => text.replace(/\s+/g, ' ').trim()

const hasOtpSignal = (sentence: string, code: string) => {
  if (OTP_SIGNAL_STANDALONE.test(sentence) || OTP_SIGNAL_COMPOUND.test(sentence)) return true
  const digitsOnly = !/[A-Za-z]/.test(code)
  return digitsOnly && OTP_SIGNAL_QUALIFIER.test(sentence) && OTP_SIGNAL_NOUN.test(sentence)
}

/**
 * Gate for an OTP the LLM fallback proposes after extractOtp() found nothing
 * (lib/llm/enrichment.ts). The model is not trusted with the value, because
 * the result feeds findLatestOtp, whose callers (agents finishing a login)
 * treat it as authoritative. A proposal is accepted only if ALL of these hold:
 *
 * 1. The code has the shape the regex extractor accepts (4-10 alphanumerics,
 *    at least one digit).
 * 2. The model quoted the phrase that justifies it (`evidence`), and that
 *    phrase really is in the body — so it cannot fabricate a context.
 * 3. The phrase is short (a sentence, not the email), reads as a one-time
 *    code (unambiguously so if the code contains letters), and does not read
 *    as a promo, order number or the like.
 * 4. The code is printed inside that phrase, on token boundaries, so a
 *    hallucinated code or the middle of a longer number never qualifies.
 * 5. No disqualifying word (promo, zip, source, ...) sits just before the
 *    code in the body — the same list extractOtp() refuses.
 *
 * Checks 3 and 5 are deterministic on purpose: they are what keeps a
 * verbatim-but-mislabelled discount code out, which the model itself cannot
 * be relied on for. Comparison is case-sensitive: a code the model lowercased
 * is not the code the user was sent. Returns the contiguous form (what a
 * person types) even when the email prints it split.
 */
export function acceptLlmOtp(
  proposal: { otp: string | null | undefined; evidence: string | null | undefined },
  bodyText: string | null | undefined,
): string | null {
  if (!proposal.otp || !proposal.evidence || !bodyText) return null

  const code = proposal.otp.replace(/[\s-]/g, '')
  if (!LLM_OTP_FORMAT.test(code) || !/\d/.test(code)) return null

  const evidence = collapseWhitespace(proposal.evidence)
  if (evidence === '' || evidence.length > LLM_OTP_EVIDENCE_MAX_LENGTH) return null
  if (!hasOtpSignal(evidence, code) || EVIDENCE_DISQUALIFIERS.test(evidence)) return null

  const body = collapseWhitespace(bodyText)
  const evidenceStart = body.indexOf(evidence)
  if (evidenceStart === -1) return null
  const evidenceEnd = evidenceStart + evidence.length

  // `code` is [A-Za-z0-9] only (checked above), so it needs no regex escaping.
  const printed = new RegExp(
    `(?<![A-Za-z0-9])${code.split('').join(LLM_OTP_SEPARATOR)}(?![A-Za-z0-9])`,
    'g',
  )
  for (const match of body.matchAll(printed)) {
    const start = match.index ?? 0
    if (start < evidenceStart || start + match[0].length > evidenceEnd) continue
    const before = body.slice(Math.max(0, start - LLM_OTP_CONTEXT_WINDOW), start)
    if (!DISQUALIFYING_NEARBY.test(before)) return code
  }
  return null
}

