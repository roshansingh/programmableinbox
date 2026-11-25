import type { ClassifiedLink } from '@/lib/email/cta-heuristic'

/**
 * Every category the classifier may assign, each with the one-line meaning the
 * model is given for it (see buildSystemPrompt).
 *
 * The definitions are what make the labels consistent. Given bare names the
 * model guesses where the boundaries are, and it guessed differently from run
 * to run: sign-in and password-reset mail was labelled with a vague catch-all
 * instead of Security. Write each as what sets the category apart from its
 * neighbours, keep it to one line, and do not mention one-time codes or OTPs
 * (the default prompt must not raise that question — see prompt.test.ts).
 *
 * This map is the single source of truth: a category cannot exist without a
 * definition, and the key order here is the order of EMAIL_CATEGORIES, which
 * the UI uses to pick each badge's colour.
 */
export const EMAIL_CATEGORY_DEFINITIONS = {
  Primary: 'Correspondence written by a person to the recipient; use only when nothing more specific fits.',
  Promotions: 'Marketing offers, sales, discounts and coupons meant to drive a purchase.',
  Social: 'Activity from social networks and messaging platforms: follows, mentions, comments and friend requests.',
  Receipts: 'Proof of a completed purchase or payment: order confirmations, invoices, and shipping or delivery notices.',
  Finance: 'Banking, cards, investments, statements, taxes and billing alerts about money held or owed.',
  Travel: 'Bookings, itineraries, boarding passes, hotel and rental confirmations, and trip changes.',
  Support: "Help-desk tickets and replies from a company's customer support team.",
  Newsletters: 'Recurring editorial content or digests from a publication, author or company; not a sales pitch.',
  Communities: 'Forum, group and community digests and discussion activity, such as Discord, Slack or Reddit.',
  Security: 'Sign-in and account-safety mail: verification and login codes, password resets, sign-in alerts and two-factor prompts.',
  Scheduling: 'Calendar invites, meeting and appointment requests, confirmations, reminders and reschedules.',
  Applications: 'Job, school or program applications: submission receipts, interview requests and decisions.',
  Notifications: 'Automated system alerts and account-activity notices that fit no more specific category.',
  Education: 'Courses, classes, learning platforms and school or training communications.',
  Agents: 'Mail sent by or addressed to an AI agent or assistant, including agent-to-agent traffic; not routine service notifications.',
  Urgent: 'Needs the reader to act soon: deadlines, outages, fraud or payment-failure warnings. May accompany another category.',
  Spam: 'Unsolicited junk, scams and phishing from senders with no legitimate relationship to the recipient.',
} as const

export type EmailCategory = keyof typeof EMAIL_CATEGORY_DEFINITIONS

export const EMAIL_CATEGORIES = Object.keys(EMAIL_CATEGORY_DEFINITIONS) as readonly EmailCategory[]

/**
 * The persisted shape of EmailMessage.metadata. `links` is populated
 * deterministically at ingestion (lib/email/extract-links.ts +
 * lib/email/cta-heuristic.ts) for every organization; lib/llm/enrichment.ts
 * only ever patches `isCta`/`ctaConfidence` on existing entries by URL match,
 * never adds or removes links.
 */
export type EnrichmentMetadata = {
  links: ClassifiedLink[]
  timestamps: string[]
}

export type CandidateLink = { url: string; label?: string }

/**
 * What the LLM provider returns. It no longer discovers links itself, and
 * OTPs are extracted deterministically first (lib/email/extract-otp.ts). Its
 * job is `categories` (real semantic classification) plus `ctaJudgments`, one
 * per link in the `candidateLinks` it was given (the ones the heuristic in
 * lib/email/cta-heuristic.ts couldn't classify confidently).
 *
 * `otp` and `otpEvidence` are the one exception, and only a fallback: they
 * are requested (see `EnrichOptions`) solely when the regex found nothing,
 * and are null whenever they weren't asked for or the model found no code.
 * `otpEvidence` is the phrase the model says shows the code is a one-time
 * code. Both are an unvalidated proposal — lib/llm/enrichment.ts must pass
 * the pair through `acceptLlmOtp` before storing anything.
 *
 * `ctaJudgments` references a candidate by its position (`i`) in the
 * `candidateLinks` array the provider was given, not by echoing the URL
 * back. Tracking links routinely run 200-400+ chars; asking the model to
 * repeat up to MAX_CTA_CANDIDATES of them verbatim can blow the output
 * token budget on nothing but URL characters and truncate the response
 * (see providers/openai-compat.ts and providers/anthropic.ts for how a
 * truncated response is surfaced rather than silently swallowed).
 */
export type LlmEnrichmentResult = {
  categories: EmailCategory[]
  ctaJudgments: Array<{ i: number; isCta: boolean }>
  timestamps: string[]
  otp: string | null
  otpEvidence: string | null
}

const ENRICHMENT_SCHEMA_PROPERTIES = {
  categories: {
    type: 'array',
    items: { type: 'string', enum: [...EMAIL_CATEGORIES] },
  },
  ctaJudgments: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        i: { type: 'integer' },
        isCta: { type: 'boolean' },
      },
      required: ['i', 'isCta'],
    },
  },
  timestamps: {
    type: 'array',
    items: { type: 'string' },
  },
} as const

// Deliberately not in `required`: they are only asked for when the regex
// extractor missed, so a response without them is the normal case. Plain
// strings rather than ['string', 'null'] — a type array is valid JSON
// Schema but one more thing a provider's tool-schema validator could
// reject, and parseEnrichmentResult already treats absent and null alike.
const OTP_SCHEMA_PROPERTIES = {
  otp: { type: 'string' },
  otpEvidence: { type: 'string' },
} as const

/**
 * The tool/response schema for one enrichment request. The otp fields are
 * included only when the request asks for a code (`extractOtp`): a schema is
 * part of the prompt for tool-calling providers, so listing them on a request
 * that did not ask would invite the model to volunteer a code the caller
 * discards, and spend output tokens doing it. This is what keeps the
 * "fallback only" contract on `EnrichOptions.extractOtp` true for the schema
 * as well as for the system prompt (lib/llm/prompt.ts).
 */
export function buildEnrichmentJsonSchema(options: EnrichOptions = {}) {
  return {
    type: 'object',
    properties: {
      ...ENRICHMENT_SCHEMA_PROPERTIES,
      ...(options.extractOtp === true ? OTP_SCHEMA_PROPERTIES : {}),
    },
    required: ['categories', 'ctaJudgments', 'timestamps'],
  } as const
}

export type EnrichOptions = {
  /**
   * Ask the model for a one-time code too. Set only when the regex extractor
   * found none — otherwise the model is never shown the question, so it
   * cannot second-guess a deterministic hit.
   */
  extractOtp?: boolean
}

/**
 * Output budget for one enrichment call. The JSON answer is well under 200
 * tokens, so this is a runaway bound, not a target. Shared so that a provider
 * whose endpoint ignores `max_completion_tokens` (Ollama's /v1 — see
 * factory.ts) can be handed the same number under the name it does honour.
 */
export const MAX_COMPLETION_TOKENS = 1024

export interface LLMProvider {
  enrich(
    subject: string,
    bodyText: string,
    candidateLinks: CandidateLink[],
    options?: EnrichOptions,
  ): Promise<LlmEnrichmentResult>
}

export function parseEnrichmentResult(raw: unknown): LlmEnrichmentResult {
  if (typeof raw !== 'object' || raw === null) {
    return { categories: [], ctaJudgments: [], timestamps: [], otp: null, otpEvidence: null }
  }
  const obj = raw as Record<string, unknown>
  return {
    categories: Array.isArray(obj.categories)
      ? (obj.categories as string[]).filter(
          (c): c is EmailCategory => (EMAIL_CATEGORIES as readonly string[]).includes(c)
        )
      : [],
    ctaJudgments: Array.isArray(obj.ctaJudgments)
      ? (obj.ctaJudgments as Array<{ i: unknown; isCta: unknown }>)
          .filter((j) => typeof j?.i === 'number' && Number.isInteger(j.i) && typeof j?.isCta === 'boolean')
          .map((j) => ({ i: j.i as number, isCta: j.isCta as boolean }))
      : [],
    timestamps: Array.isArray(obj.timestamps) ? (obj.timestamps as string[]) : [],
    otp: typeof obj.otp === 'string' ? obj.otp : null,
    otpEvidence: typeof obj.otpEvidence === 'string' ? obj.otpEvidence : null,
  }
}
