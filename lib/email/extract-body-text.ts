import { convert } from 'html-to-text'

/**
 * Cap on the derived body text, in characters.
 *
 * This is a correctness bound, not a storage preference. `EmailMessage.searchVector`
 * is a STORED generated column computed during INSERT, and `to_tsvector` raises an
 * error once the resulting vector exceeds 1 MB — so an oversized email would not
 * merely be unsearchable, it would fail ingestion outright. The migration applies
 * the same cap with `left(...)` inside the generated expression, which is what makes
 * that state unreachable; this one keeps the stored column from carrying bytes the
 * index will never see anyway.
 *
 * Must stay in sync with the `left(..., 100000)` in the migration that adds
 * `searchVector`.
 */
export const MAX_BODY_TEXT_LENGTH = 100_000

/**
 * A text part shorter than this is not trusted to be the whole message.
 *
 * Some senders ship a text alternative that is only the code ("727226") while the
 * HTML carries the sentence around it. The OTP extractors need that sentence, so
 * below this length the HTML is consulted too. Long enough to cover a bare code
 * or a one-line stub; short enough that a genuine plain-text body is never second-guessed.
 */
export const MIN_TEXT_PART_LENGTH = 32

/**
 * Options chosen for indexing, not for display.
 *
 * `<script>`, `<style>` and `<head>` are skipped by html-to-text's defaults, which
 * is the whole reason this uses a parser rather than a tag-stripping regex: a large
 * share of real mail is templated marketing HTML carrying multi-kilobyte `<style>`
 * blocks, and indexing those would fill the search vector with CSS selectors and
 * class names.
 *
 * Link hrefs are dropped rather than inlined: tracking URLs are long, high-entropy
 * and per-recipient, so indexing them adds noise and lets a search for a common word
 * match on a URL fragment. Images are skipped for the same reason — alt text is
 * frequently boilerplate ("logo", "spacer").
 */
const CONVERT_OPTIONS = {
  wordwrap: false as const,
  selectors: [
    { selector: 'a', options: { ignoreHref: true } },
    { selector: 'img', format: 'skip' },
  ],
}

/**
 * The best-effort plain text of a message body, for full-text search.
 *
 * Returns the sender's own text part when there is one — it is authoritative, and
 * re-deriving it from the HTML alternative would only lose fidelity. Falls back to
 * text extracted from the HTML, which is the case this exists for: HTML-only mail
 * (most marketing, receipt and notification email) arrives with an empty text part,
 * so before this its entire body was searchable only as an HTML blob.
 *
 * A text part under MIN_TEXT_PART_LENGTH is treated as a possible stub: the HTML
 * text wins if it is longer, otherwise the sender's text is kept.
 *
 * Returns null when there is no body at all, so the column distinguishes "no text"
 * from "not yet derived" for rows predating the feature.
 */
export function deriveBodyText(input: { text: string; html: string }): string | null {
  const provided = input.text.trim()
  if (provided.length >= MIN_TEXT_PART_LENGTH) return truncate(provided)

  const extracted = input.html.trim() ? convert(input.html, CONVERT_OPTIONS).trim() : ''
  if (extracted.length > provided.length) return truncate(extracted)

  return provided ? truncate(provided) : null
}

function truncate(value: string): string {
  return value.length > MAX_BODY_TEXT_LENGTH ? value.slice(0, MAX_BODY_TEXT_LENGTH) : value
}
