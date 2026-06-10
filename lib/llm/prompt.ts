import { EMAIL_CATEGORIES } from './types'

export function buildSystemPrompt(): string {
  return `You are an email analysis assistant. Analyze the email and return structured JSON.

CATEGORIES — select 1-3 that best describe the email (use exact names):
${EMAIL_CATEGORIES.join(', ')}

RULES:
- categories: Pick 1-3 from the list above. Always include at least one.
- extractedOtp: If a numeric OTP, PIN, or verification code is present, return it as a string of digits only. Return null if none found.
- metadata.links: Extract all URLs. Set isCta=true for primary action links (e.g. "Verify Email", "Confirm", "Reset Password", "Click here").
- metadata.timestamps: Extract explicit date/time references as strings.

Respond with JSON only, no prose. Match this structure exactly:
{"categories":["..."],"extractedOtp":"123456 or null","metadata":{"links":[{"url":"...","label":"...","isCta":true}],"timestamps":["..."]}}`
}
