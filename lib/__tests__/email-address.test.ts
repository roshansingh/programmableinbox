import { describe, expect, it } from 'vitest'
import { normalizeInboxAddress, isValidInboxAddress, splitAddress } from '@/lib/email-address'

describe('splitAddress', () => {
  it('splits a normalized address into local part and domain', () => {
    expect(splitAddress('billing@corp.com')).toEqual({
      localPart: 'billing',
      domain: 'corp.com',
    })
  })

  it('splits on the last @, so a quoted local part cannot smuggle the domain', () => {
    // ADDRESS_PATTERN rejects multiple @ today, but splitting on the last one
    // means this helper can never hand a caller a domain that is really part of
    // the local part — the domain check must see the routable half.
    expect(splitAddress('a@b@corp.com')).toEqual({ localPart: 'a@b', domain: 'corp.com' })
  })

  it('lowercases, so callers cannot compare a raw address against the allowlist', () => {
    expect(splitAddress('Billing@Corp.com')).toEqual({
      localPart: 'billing',
      domain: 'corp.com',
    })
  })

  it('returns null when there is no domain to check', () => {
    expect(splitAddress('billing')).toBeNull()
    expect(splitAddress('billing@')).toBeNull()
    expect(splitAddress('@corp.com')).toBeNull()
  })
})

describe('normalizeInboxAddress', () => {
  it('lowercases the whole address', () => {
    // Inbound routing lowercases the recipient before matching, so a stored
    // `Billing@Corp.com` would never receive mail — and would leave
    // `billing@corp.com` free for another tenant to claim.
    expect(normalizeInboxAddress('Billing@Corp.com')).toBe('billing@corp.com')
  })

  it('lowercases the local part too, not just the domain', () => {
    expect(normalizeInboxAddress('BILLING@corp.com')).toBe('billing@corp.com')
  })

  it('strips surrounding whitespace', () => {
    expect(normalizeInboxAddress('  billing@corp.com \t')).toBe('billing@corp.com')
  })

  it('is idempotent', () => {
    const once = normalizeInboxAddress(' Billing@Corp.com ')
    expect(normalizeInboxAddress(once)).toBe(once)
  })

  it('maps every case variant of one address onto the same value', () => {
    const variants = ['billing@corp.com', 'Billing@corp.com', 'BILLING@CORP.COM', 'bIlLiNg@CoRp.CoM']
    expect(new Set(variants.map(normalizeInboxAddress)).size).toBe(1)
  })
})

describe('isValidInboxAddress', () => {
  it.each([
    'billing@corp.com',
    'inbox-1@test.dev',
    'a.b+tag@sub.example.co.uk',
  ])('accepts %s', (address) => {
    expect(isValidInboxAddress(address)).toBe(true)
  })

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['no @', 'billingcorp.com'],
    ['two @', 'a@b@corp.com'],
    ['empty local part', '@corp.com'],
    ['empty domain', 'billing@'],
    ['dotless domain', 'billing@localhost'],
    ['internal whitespace', 'bil ling@corp.com'],
    ['trailing dot label', 'billing@corp.'],
    ['newline injection', 'billing@corp.com\nbcc: attacker@evil.com'],
  ])('rejects %s', (_label, address) => {
    expect(isValidInboxAddress(address)).toBe(false)
  })

  it('rejects addresses over 254 characters', () => {
    expect(isValidInboxAddress(`${'a'.repeat(250)}@corp.com`)).toBe(false)
  })

  it('validates the normalized form, so case never changes the verdict', () => {
    expect(isValidInboxAddress('BILLING@CORP.COM')).toBe(isValidInboxAddress('billing@corp.com'))
  })
})

describe('isValidInboxAddress — ASCII-only (no Unicode)', () => {
  // Non-ASCII inputs built from code points so the test source stays plain ASCII
  // and there are no invisible characters hiding in the file.
  const CYRILLIC_A = String.fromCodePoint(0x0430) // а — homoglyph of Latin a
  const E_ACUTE = String.fromCodePoint(0x00e9) // é
  const NBSP = String.fromCodePoint(0x00a0)
  const ZWSP = String.fromCodePoint(0x200b)
  const THUMBS = String.fromCodePoint(0x1f44d)
  const BEL = String.fromCodePoint(0x0007) // ASCII control

  it.each([
    ['a cyrillic homoglyph in the local part', `${CYRILLIC_A}dmin@corp.com`],
    ['an accented latin letter', `caf${E_ACUTE}@corp.com`],
    ['an emoji', `${THUMBS}@corp.com`],
    ['an interior non-breaking space', `bill${NBSP}ing@corp.com`],
    ['an interior zero-width space', `bil${ZWSP}ling@corp.com`],
    ['a non-ASCII (IDN) domain', `billing@${CYRILLIC_A}.com`],
    ['an ASCII control character', `billing${BEL}@corp.com`],
  ])('rejects %s', (_label, address) => {
    expect(isValidInboxAddress(address)).toBe(false)
  })

  it('accepts the ASCII local-part characters a receiving address may use', () => {
    expect(isValidInboxAddress("a.b+tag_1%x-y@sub.corp.co")).toBe(true)
  })

  it('trims Unicode-whitespace padding rather than rejecting it — the stored value is clean ASCII', () => {
    // `.trim()` removes leading/trailing NBSP, so the padded input normalizes to
    // a valid ASCII address. Only non-ASCII in the *content* is a problem.
    expect(isValidInboxAddress(`${NBSP}billing@corp.com${NBSP}`)).toBe(true)
    expect(normalizeInboxAddress(`${NBSP}billing@corp.com${NBSP}`)).toBe('billing@corp.com')
  })

  it('does not let toLowerCase fold a homoglyph into its ASCII look-alike', () => {
    // Guards the reasoning behind checking the normalized form: the Cyrillic а
    // must stay non-ASCII after normalization, not become a Latin a.
    expect(normalizeInboxAddress(`${CYRILLIC_A}dmin@corp.com`)).toContain(CYRILLIC_A)
  })
})
