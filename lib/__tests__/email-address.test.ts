import { describe, expect, it } from 'vitest'
import { normalizeInboxAddress, isValidInboxAddress } from '@/lib/email-address'

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
