import { EMAIL_CATEGORIES } from './types'
import type { CandidateLink } from './types'

export function buildSystemPrompt(): string {
  return `You are an email analysis assistant. Analyze the email and return structured JSON.

CATEGORIES — select 1-2 that best describe the email (use exact names):
${EMAIL_CATEGORIES.join(', ')}

RULES:
- categories: Pick 1-2 from the list above. Always include at least one.
- ctaJudgments: You will be given a list of candidate links found in the email. For each one, decide whether it is a primary call-to-action link (e.g. "Verify Email", "Confirm", "Reset Password") as opposed to a secondary/utility link (e.g. social icons, unsubscribe, view-in-browser). Return exactly one entry per candidate link you were given. If no candidate links are given, return an empty array.
- timestamps: Extract explicit date/time references from the body as strings.

Respond with JSON only, no prose. Match this structure exactly:
{"categories":["..."],"ctaJudgments":[{"url":"...","isCta":true}],"timestamps":["..."]}`
}

export function buildUserMessage(subject: string, bodyText: string, candidateLinks: CandidateLink[]): string {
  const linksSection =
    candidateLinks.length > 0
      ? `\n\nCandidate links:\n${candidateLinks.map((l) => `- ${l.url}${l.label ? ` ("${l.label}")` : ''}`).join('\n')}`
      : ''
  return `Subject: ${subject}\n\nBody:\n${bodyText.slice(0, 4000)}${linksSection}`
}
