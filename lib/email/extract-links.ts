import * as cheerio from 'cheerio'

export type ExtractedLink = { url: string; label?: string }

const MAX_LINKS = 50
const BARE_URL_PATTERN = /https?:\/\/[^\s<>"']+/g
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/

/**
 * Candidate links for CTA classification (lib/email/cta-heuristic.ts) and OTP
 * context. Parses real `href` attributes out of HTML rather than the
 * LLM-bound `bodyText` (lib/email/extract-body-text.ts strips hrefs on
 * purpose, for search-index noise reasons) — this is the only place in the
 * pipeline that ever sees the real link targets. Falls back to a bare-URL
 * scan of the plain-text part for text-only mail.
 */
export function extractLinks(input: { text: string; html: string }): ExtractedLink[] {
  const links = input.html.trim() ? extractFromHtml(input.html) : extractFromText(input.text)
  return links.slice(0, MAX_LINKS)
}

function extractFromHtml(html: string): ExtractedLink[] {
  const $ = cheerio.load(html)
  const seen = new Set<string>()
  const links: ExtractedLink[] = []

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')
    const url = href ? normalizeUrl(href) : null
    if (!url || seen.has(url)) return
    seen.add(url)
    const label = $(el).text().trim()
    links.push(label ? { url, label } : { url })
  })

  return links
}

function extractFromText(text: string): ExtractedLink[] {
  const seen = new Set<string>()
  const links: ExtractedLink[] = []

  for (const raw of text.match(BARE_URL_PATTERN) ?? []) {
    const url = normalizeUrl(raw.replace(TRAILING_PUNCTUATION, ''))
    if (!url || seen.has(url)) continue
    seen.add(url)
    links.push({ url })
  }

  return links
}

function normalizeUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null
  } catch {
    return null
  }
}
