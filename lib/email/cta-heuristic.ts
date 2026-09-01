import type { ExtractedLink } from './extract-links'

export type ClassifiedLink = ExtractedLink & { isCta: boolean; ctaConfidence: 'high' | 'low' }

const CTA_KEYWORDS = [
  'verify', 'confirm', 'activate', 'reset password', 'sign in', 'log in', 'login',
  'get started', 'complete your', 'accept invitation', 'rsvp', 'shop now', 'buy now',
  'order now', 'track order', 'track package', 'view order', 'download', 'claim',
  'redeem', 'renew', 'upgrade', 'join now', 'book now', 'pay now', 'checkout',
]

const NON_CTA_KEYWORDS = [
  'unsubscribe', 'view in browser', 'privacy policy', 'terms of service',
  'terms & conditions', 'manage preferences', 'update preferences', 'contact us',
  'help center', 'support center', 'view this email', 'read more', 'learn more',
  'follow us', 'facebook', 'twitter', 'instagram', 'linkedin',
]

/**
 * Keyword-based CTA classification. `ctaConfidence` records whether `isCta`
 * came from this heuristic ('low') or was later confirmed by the LLM
 * ('high') — lib/llm/enrichment.ts only sends 'low' links to the model for
 * review, and merges its judgments back by URL. A link with no anchor text
 * (a bare URL) has nothing to match against, so it's always 'low'.
 */
export function classifyLinks(links: ExtractedLink[]): ClassifiedLink[] {
  return links.map(classify)
}

function classify(link: ExtractedLink): ClassifiedLink {
  const label = link.label?.toLowerCase().trim() ?? ''

  if (!label) return { ...link, isCta: false, ctaConfidence: 'low' }
  if (NON_CTA_KEYWORDS.some((kw) => label.includes(kw))) {
    return { ...link, isCta: false, ctaConfidence: 'high' }
  }
  if (CTA_KEYWORDS.some((kw) => label.includes(kw))) {
    return { ...link, isCta: true, ctaConfidence: 'high' }
  }
  return { ...link, isCta: false, ctaConfidence: 'low' }
}
