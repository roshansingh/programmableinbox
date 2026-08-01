import { describe, it, expect } from 'vitest'
import {
  isBlockedTerm,
  hasDisallowedNameCharacters,
} from '@/lib/security/blocked-inbox-terms'

describe('isBlockedTerm — plain brand terms', () => {
  it.each([
    'amazon',
    'apple',
    'google',
    'microsoft',
    'paypal',
    'netflix',
    'coinbase',
    'fedex',
    'programmableinbox',
  ])('blocks the bare term %s', (term) => {
    expect(isBlockedTerm(term)).toBe(true)
  })
})

describe('isBlockedTerm — separator evasion', () => {
  it.each([
    ['hyphens', 'g-o-o-g-l-e'],
    ['dots', 'g.o.o.g.l.e'],
    ['underscores', 'g_oogle'],
    ['plus tags', 'goo+gle'],
    ['mixed', 'a-m.a_z0n'],
  ])('collapses %s (%s)', (_label, input) => {
    expect(isBlockedTerm(input)).toBe(true)
  })
})

describe('isBlockedTerm — leetspeak folding', () => {
  it.each([
    ['g00gle', 'zero for o'],
    ['app1e', 'one for l'],
    ['pAyPa1', 'mixed case and one for l'],
    ['micr0s0ft', 'zeros'],
    ['n3tflix', 'three for e'],
    ['p4ypal', 'four for a'],
    ['micro$oft', 'dollar for s'],
    ['ne7flix', 'seven for t'],
    ['amaz0n', 'zero for o'],
  ])('folds %s (%s)', (input) => {
    expect(isBlockedTerm(input)).toBe(true)
  })

  /**
   * `1` stands in for `i` at least as often as for `l`, and a fold table that
   * picks only one of them leaves a one-character bypass on every term
   * containing an `i` — including `admin`, `billing` and `security`, the three
   * the module calls the sharpest version of the risk. Canonicalizing the whole
   * confusable class (rather than mapping each character to a single letter) is
   * what closes it.
   */
  it.each([
    ['adm1n', 'one for i in a staff term'],
    ['b1lling', 'one for i in a staff term'],
    ['secur1ty', 'one for i in a staff term'],
    ['he1pdesk', 'one for l where i is the other reading'],
    ['m1crosoft', 'one for i in a brand'],
    ['netfl1x', 'one for i in a brand'],
    ['g1thub', 'one for i in a brand'],
    ['1nstagram', 'leading one for i'],
    ['l1nked1n', 'both readings of one in one string'],
    ['c1t1bank', 'repeated'],
    ['paypa!', 'bang for l'],
    ['goog|e', 'pipe for l'],
  ])('folds %s (%s)', (input) => {
    expect(isBlockedTerm(input)).toBe(true)
  })

  it.each([
    ['ama2on', 'two for z'],
    ['e8ay', 'eight for b'],
    ['9oogle', 'nine for g'],
    ['6oogle', 'six for g'],
  ])('folds the remaining digit confusables: %s (%s)', (input) => {
    expect(isBlockedTerm(input)).toBe(true)
  })

  /**
   * `a → @` is the commonest substitution in real phishing, and stripping it as
   * punctuation rather than folding it made every `a`-bearing brand claimable
   * as a display name (the address path rejects `@` for other reasons).
   */
  it.each([
    ['Am@zon', 'at for a'],
    ['P@yPal', 'at for a'],
    ['(oinbase', 'paren for c'],
    ['<oinbase', 'angle for c'],
  ])('folds symbol confusables: %s (%s)', (input) => {
    expect(isBlockedTerm(input)).toBe(true)
  })
})

describe('isBlockedTerm — embedded in a longer address', () => {
  it.each([
    'amazon-security',
    'secure-apple-id',
    'googlebilling',
    'your-paypal-account',
    'netflix.billing.update',
    'microsoft365support',
  ])('blocks %s — the embedded brand is the whole attack', (input) => {
    expect(isBlockedTerm(input)).toBe(true)
  })
})

describe('isBlockedTerm — platform self-impersonation', () => {
  it.each([
    'programmable-inbox',
    'programmableinbox',
    'pibx',
    'pi-support',
    'pi',
    'pi.team',
    'admin',
    'support',
    'noreply',
    'no-reply',
    'postmaster',
    'abuse',
    'security',
    'billing',
    'helpdesk',
  ])('blocks %s — it reads as the platform on the platform’s own domain', (input) => {
    expect(isBlockedTerm(input)).toBe(true)
  })
})

describe('isBlockedTerm — short terms match only as standalone tokens', () => {
  it.each([
    ['pizza', 'contains pi'],
    ['pineapple', 'contains pi and apple'],
    ['pilot', 'contains pi'],
    ['groups', 'contains ups'],
    ['startups', 'contains ups'],
    ['purchase', 'contains chase'],
    ['otherwise', 'contains wise'],
    ['metadata', 'contains meta'],
    ['maxwell', 'contains x'],
  ])('allows %s (%s)', (input) => {
    expect(isBlockedTerm(input)).toBe(false)
  })

  it.each([
    ['pi', 'whole string'],
    ['pi-team', 'separator-bounded'],
    ['ups-delivery', 'separator-bounded'],
    ['gov-notice', 'separator-bounded'],
    ['chase.alerts', 'separator-bounded'],
  ])('blocks %s (%s)', (input) => {
    expect(isBlockedTerm(input)).toBe(true)
  })

  /**
   * A bare `x` is a person's initial far more often than it is the brand, and
   * `twitter` already covers the brand as a substring. Blocking it rejected
   * "Alex X" and "Project X" as display names, which is a worse trade than
   * missing `x@` as a local part.
   */
  it.each(['Alex X', 'Project X', 'Gen X', 'x'])('allows a standalone x in %s', (input) => {
    expect(isBlockedTerm(input)).toBe(false)
  })

  it('still blocks the spelled-out brand', () => {
    expect(isBlockedTerm('twitter-support')).toBe(true)
  })
})

/**
 * Canonicalizing a confusable class collapses `i` and `l` onto one letter, so
 * these guard the words that distinction usually separates. A regression here
 * means the fold got too aggressive, not too weak.
 */
describe('isBlockedTerm — confusable folding does not over-match', () => {
  it.each([
    'mail',
    'mall',
    'invoices',
    'billboard-design',
    'silly',
    'illinois',
    'militia',
    'alias',
    'lilac',
    'admiral',
  ])('allows %s', (input) => {
    expect(isBlockedTerm(input)).toBe(false)
  })

  it('still rejects a word that genuinely contains a staff term', () => {
    // `administer` really does contain `admin`, so this is the documented
    // collateral of substring matching (same class as `supporter`), not a
    // regression in the confusable fold.
    expect(isBlockedTerm('administer')).toBe(true)
  })
})

describe('isBlockedTerm — substring exceptions', () => {
  it('allows applecart, which only contains apple incidentally', () => {
    expect(isBlockedTerm('applecart')).toBe(false)
  })

  it('still blocks apple inside a genuine lookalike', () => {
    expect(isBlockedTerm('apple-support')).toBe(true)
  })

  it('does not let an exception word shield an adjacent blocked term', () => {
    expect(isBlockedTerm('applecart-amazon')).toBe(true)
  })
})

describe('isBlockedTerm — ordinary names are left alone', () => {
  it.each(['roshan', 'testing123', 'invoices', 'team-alpha', 'qa', 'newsletter'])(
    'allows %s',
    (input) => {
      expect(isBlockedTerm(input)).toBe(false)
    },
  )

  it('allows an empty string rather than treating it as a hit', () => {
    expect(isBlockedTerm('')).toBe(false)
  })
})

describe('hasDisallowedNameCharacters', () => {
  it('allows a normal display name with spaces', () => {
    expect(hasDisallowedNameCharacters('Support Inbox')).toBe(false)
  })

  it('allows printable ASCII punctuation', () => {
    expect(hasDisallowedNameCharacters("Roshan's QA (test) #2")).toBe(false)
  })

  it('rejects a Cyrillic homoglyph, which would otherwise walk past the blocklist', () => {
    // U+0410 CYRILLIC CAPITAL LETTER A — visually identical to Latin "A".
    expect(hasDisallowedNameCharacters('Аmazon')).toBe(true)
    expect(isBlockedTerm('Аmazon')).toBe(false) // exactly why the charset guard is needed
  })

  it('rejects a zero-width space used to split a blocked term', () => {
    expect(hasDisallowedNameCharacters('goo​gle')).toBe(true)
  })

  it('rejects a non-breaking space, which reads as an ordinary space', () => {
    expect(hasDisallowedNameCharacters('Support Inbox')).toBe(true)
  })

  it('rejects emoji', () => {
    expect(hasDisallowedNameCharacters('Inbox 🎉')).toBe(true)
  })

  it('rejects control characters', () => {
    expect(hasDisallowedNameCharacters('Inbox\n')).toBe(true)
  })

  it('allows an empty name — optional fields are absent, not invalid', () => {
    expect(hasDisallowedNameCharacters('')).toBe(false)
  })
})
