/**
 * Brand and platform impersonation blocklist for inbox local parts and display
 * names (issue #98).
 *
 * The domain allowlist (the `emailInbox` slice of `lib/config`) guarantees that
 * every inbox sits on a domain we own and actually receive mail at. That is
 * precisely what makes this list necessary: `amazon-security@<our-domain>` is
 * not a spoof, it is a real, working, receiving address, usable to collect
 * replies to a phishing run. `pi-support@<our-domain>` is the same weapon aimed
 * at our own users.
 *
 * This is deterrence, not a proof. A determined attacker will find a phrasing
 * that reads as a brand without containing its name. The list raises the cost
 * of the obvious attempts, which is the whole claim being made for it.
 */

/**
 * Groups of characters that are visually interchangeable in a mail client. The
 * first character of each group is the canonical form; every other member folds
 * onto it.
 *
 * **Classes, not a one-way substitution table.** The obvious design — map each
 * leet character to the letter it "means" — cannot work, because the mapping is
 * not a function: `1` stands for `i` and for `l` about equally often. Picking
 * either one leaves a one-character bypass on every term containing the other,
 * and the terms that suffer are the ones that matter most: `adm1n`, `b1lling`
 * and `secur1ty` all sailed through a table that mapped `1 → l`.
 *
 * Collapsing the whole class instead — `i`, `l`, `1`, `!`, `|` all become `i` —
 * removes the ambiguity by refusing to resolve it. The cost is that words
 * distinguished only by `i` versus `l` become equal (`mail` and `mall` both
 * canonicalize to `maii`), so a term must not be one of those; the tests pin
 * the words this could plausibly have caught.
 *
 * The same folding is applied to the term list at module load, so a term never
 * needs to be spelled in canonical form by hand.
 */
const CONFUSABLE_CLASSES = [
  'o0', // o and zero
  'il1!|', // i, l, one, bang, pipe — deliberately one class, see above
  'e3', // e and three
  'a4@', // a, four, at — `@` is the commonest substitution in real phishing
  's5$', // s, five, dollar
  // `t` and seven. `+` is deliberately NOT here: in a local part it is the
  // plus-tag separator far more often than a stylized `t`, and folding it
  // would stop `goo+gle` from collapsing to `google`.
  't7',
  'b8', // b and eight
  'g96', // g, nine, six
  'z2', // z and two
  'c(<', // c and bracket shapes
]

/** Flattened lookup: every member of a class → that class's first character. */
const CANONICAL: Record<string, string> = {}
for (const group of CONFUSABLE_CLASSES) {
  for (const member of group) CANONICAL[member] = group[0]
}

/**
 * Lowercase, canonicalize confusables, then strip everything that is not a
 * surviving alphanumeric — so `g-o-o-g-l-e`, `g.o.o.g.l.e`, `g_oogle`, `g00gle`
 * and `9oogle` all collapse to the same token.
 *
 * Non-ASCII characters are stripped rather than folded — this function makes no
 * attempt at homoglyph detection. For the address that is already handled:
 * `PRINTABLE_ASCII` in `lib/email-address.ts` rejects non-ASCII outright. For
 * display names it is `hasDisallowedNameCharacters` below, which must be
 * checked *alongside* this function, never instead of it.
 */
function normalize(value: string): string {
  let out = ''

  for (const char of value.toLowerCase()) {
    const folded = CANONICAL[char] ?? char
    if (folded >= 'a' && folded <= 'z') out += folded
    else if (folded >= '0' && folded <= '9') out += folded
  }

  return out
}

/**
 * Terms distinctive enough that appearing anywhere in the normalized string is
 * itself the signal. Substring matching is deliberate: `amazon-security`,
 * `secure-apple-id` and `googlebilling` are the attack, and exact matching
 * stops none of them.
 *
 * A term only belongs here if it is unlikely to occur inside an ordinary
 * English word. Anything that does — `chase` in `purchase`, `ups` in `groups` —
 * goes in BLOCKED_TOKEN_TERMS instead.
 */
const BLOCKED_SUBSTRING_TERMS = [
  // Retail / tech brands
  'adobe',
  'airbnb',
  'alibaba',
  'anthropic',
  'apple',
  'amazon',
  'binance',
  'booking',
  'coinbase',
  'disney',
  'dropbox',
  'ebay',
  'facebook',
  'github',
  'google',
  'hmrc',
  'instagram',
  'linkedin',
  'metamask',
  'microsoft',
  'netflix',
  'openai',
  'paypal',
  'revolut',
  'spotify',
  'stripe',
  'tiktok',
  'twitter',
  'walmart',
  'whatsapp',
  // Banks / payments
  'bankofamerica',
  'barclays',
  'cashapp',
  'citibank',
  'hsbc',
  'venmo',
  'wellsfargo',
  // Shipping / government
  'dhl',
  'fedex',
  'royalmail',
  'usps',
  // Platform self-impersonation — these read as *us*, on a domain we own,
  // which is the sharpest version of the risk.
  'pibx',
  'programmableinbox', // `programmable-inbox` normalizes to the same token
  // Staff-sounding terms. A recipient reads `billing@<our-domain>` as the
  // platform's own billing desk, so these are reserved rather than claimable.
  // Collateral is accepted here: `supporter` and `securityteam` are rejected
  // too. Inboxes are cheap to create — a rejection costs one retry.
  'abuse',
  'admin',
  'billing',
  'helpdesk',
  'noreply',
  'postmaster',
  'security',
  'support',
] as const

/**
 * Terms that are either very short or common English fragments, matched only
 * when they stand alone.
 *
 * Substring matching these would reject far more legitimate names than it
 * blocks attacks — `ups` inside `groups` and `startups`, `chase` inside
 * `purchase`, `meta` inside `metadata`, `wise` inside `otherwise`, `x` inside
 * almost anything. Standalone matching still catches the realistic attempt,
 * which nearly always separates the brand: `ups-delivery`, `chase.alerts`,
 * `gov-notice`.
 */
const BLOCKED_TOKEN_TERMS = [
  'chase',
  'gov',
  'irs',
  'meta',
  'pi', // the platform's short name
  'steam',
  'uber',
  'ups',
  'wise',
  // `x` is deliberately absent. A bare X is a person's initial far more often
  // than it is the brand — it rejected "Alex X" and "Project X" as display
  // names — and `twitter` already covers the brand as a substring.
] as const

/**
 * Ordinary words that happen to contain a blocked substring. Each is masked out
 * before matching, so the word itself passes while a blocked term sitting
 * *next* to it is still caught (`applecart-amazon` is rejected).
 *
 * Kept deliberately short. The issue's guidance is to bias toward rejecting:
 * a false positive costs a user one retry, a false negative ships a working
 * phishing address on a domain we own.
 */
const ALLOWED_SUBSTRING_EXCEPTIONS = ['applecart', 'pineapple'] as const

/**
 * Separator used to mask exception words so matching cannot span the gap.
 *
 * Written as an escape, never as a literal control character: a raw NUL byte in
 * the source makes git classify this file as binary, and the one file in the
 * repo that must stay reviewable line by line is the security term list.
 * `normalize` strips it, so it cannot be forged from user input.
 */
const MASK = '\u0000'

/**
 * The term lists, canonicalized once at module load.
 *
 * Terms are written in ordinary spelling above and folded here, so adding
 * `netflix` does not require knowing that `i` canonicalizes onto the same
 * character as `l`. Comparing raw terms against a canonicalized input would
 * silently match nothing for every term containing a folded character.
 */
const CANONICAL_SUBSTRING_TERMS = BLOCKED_SUBSTRING_TERMS.map(normalize)
const CANONICAL_TOKEN_TERMS = BLOCKED_TOKEN_TERMS.map(normalize)
const CANONICAL_EXCEPTIONS = ALLOWED_SUBSTRING_EXCEPTIONS.map(normalize)

/**
 * Printable ASCII including space (0x20–0x7e).
 *
 * The address path is already ASCII-only, but the display name had no charset
 * guard at all, which left the blocklist trivially bypassable: Cyrillic `Аmazon`
 * (U+0410) is a different string from `Amazon` and normalizes to `mazon`, so it
 * would sail through. Zero-width and non-breaking spaces do the same job
 * invisibly.
 *
 * ASCII-only rejects legitimate non-Latin names, which is a real cost accepted
 * for v1 (issue #98 open question 2). The alternative — NFKC plus confusable
 * folding — is more code and still incomplete.
 */
const PRINTABLE_ASCII_WITH_SPACE = /^[\x20-\x7e]*$/

/**
 * True when the value contains a character a display name may not contain.
 *
 * Must be checked *in addition to* `isBlockedTerm`, not instead of it — it
 * answers a different question. `validateInboxName` in
 * `lib/validation/inbox-policy.ts` runs both so callers cannot check one and
 * forget the other.
 */
export function hasDisallowedNameCharacters(value: string): boolean {
  return !PRINTABLE_ASCII_WITH_SPACE.test(value)
}

/**
 * Split the *raw* input on non-alphanumeric characters and normalize each
 * piece, so a short term is only matched where the user actually separated it.
 * `pi-team` yields ['pi', 'team']; `pizza` yields ['pizza'].
 */
function rawTokens(value: string): string[] {
  return value
    .split(/[^\p{L}\p{N}]+/u)
    .map(normalize)
    .filter((token) => token !== '')
}

/**
 * True when the value impersonates a brand or the platform itself.
 *
 * Applied to the inbox local part and to the display name, on create *and* on
 * rename — a blocklist enforced only at creation is worthless, because
 * `support` can be created as `qa` and renamed afterwards.
 */
export function isBlockedTerm(value: string): boolean {
  const normalized = normalize(value)
  if (normalized === '') return false

  // Mask exception words first, then scan the surviving segments, so
  // `pineapple` passes but `applecart-amazon` still fails.
  let masked = normalized
  for (const exception of CANONICAL_EXCEPTIONS) {
    masked = masked.split(exception).join(MASK)
  }

  for (const segment of masked.split(MASK)) {
    if (CANONICAL_SUBSTRING_TERMS.some((term) => segment.includes(term))) return true
  }

  const tokens = rawTokens(value)
  return CANONICAL_TOKEN_TERMS.some(
    (term) => normalized === term || tokens.includes(term),
  )
}
