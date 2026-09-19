import { EMAIL_CATEGORIES } from './types'
import type { CandidateLink, EnrichOptions } from './types'

/**
 * The rule the model sees only when the regex extractor already missed
 * (EnrichOptions.extractOtp). The exclusions mirror what extract-otp.ts
 * refuses, because the model's answer is checked for *presence* in the body
 * (acceptLlmOtp), which checks the quoted evidence and the text around the
 * code with deterministic rules, so the model's judgment is the first filter
 * for a mislabelled promo code, not the only one.
 */
const OTP_RULE = `
- otp: Return the one-time password, verification code, security code or PIN that the recipient is meant to type in to sign in, confirm or verify something — copied exactly as printed in the email, never invented, guessed, completed or reformatted. Return null if there is no such code or you are not sure. Do not return promo, coupon, discount or referral codes, order, tracking or confirmation numbers, zip or postal codes, phone numbers, or amounts.
- otpEvidence: When otp is not null, the exact sentence or phrase from the email — at most 200 characters, copied character for character — that contains the code and shows it is a one-time code (for example, the sentence saying it is your verification code). Null when otp is null.`

export function buildSystemPrompt(options: EnrichOptions = {}): string {
  const otp = options.extractOtp === true
  return `You are an email analysis assistant. Analyze the email and return structured JSON.

CATEGORIES — select 1-2 that best describe the email (use exact names):
${EMAIL_CATEGORIES.join(', ')}

RULES:
- categories: Pick 1-2 from the list above. Always include at least one.
- ctaJudgments: You will be given a numbered list of candidate links found in the email. For each one, decide whether it is a primary call-to-action link (e.g. "Verify Email", "Confirm", "Reset Password") as opposed to a secondary/utility link (e.g. social icons, unsubscribe, view-in-browser). Return exactly one entry per candidate link, referencing it by its index number "i" (0-based, matching its position in the numbered list) — do not repeat the URL itself. If no candidate links are given, return an empty array.
- timestamps: Extract explicit date/time references from the body as strings.${otp ? OTP_RULE : ''}

Respond with JSON only, no prose. Match this structure exactly:
{"categories":["..."],"ctaJudgments":[{"i":0,"isCta":true}],"timestamps":["..."]${otp ? ',"otp":"...","otpEvidence":"..."' : ''}}`
}

/**
 * How much of the body the provider is shown. Exported so the caller can cut
 * the text *once*, before the provider call, and hold the OTP grounding check
 * (acceptLlmOtp) to exactly the characters the model saw — a check against the
 * full body would accept a code from a tail the model never read.
 */
export const MAX_PROMPT_BODY_LENGTH = 4000

export function buildUserMessage(subject: string, bodyText: string, candidateLinks: CandidateLink[]): string {
  const linksSection =
    candidateLinks.length > 0
      ? `\n\nCandidate links:\n${candidateLinks.map((l, i) => `${i}: ${l.url}${l.label ? ` ("${l.label}")` : ''}`).join('\n')}`
      : ''
  return `Subject: ${subject}\n\nBody:\n${bodyText.slice(0, MAX_PROMPT_BODY_LENGTH)}${linksSection}`
}
