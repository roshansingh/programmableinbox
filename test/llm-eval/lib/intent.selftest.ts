import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { intentDisagreements, parseIntent, readIntent } from './intent'
import type { Snapshot } from './types'

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  extractedOtp: null,
  categories: ['Travel'],
  metadata: { links: [], timestamps: [] },
  ...over,
})

describe('parseIntent', () => {
  it('accepts categories, otp and an optional note', () => {
    expect(parseIntent({ categories: ['Finance', 'Urgent'], otp: null, note: 'why' }, 'f')).toEqual({
      categories: ['Finance', 'Urgent'],
      otp: null,
      note: 'why',
    })
  })

  it.each([
    ['not an object', [], /must contain a JSON object/],
    ['an unknown key', { categories: ['Travel'], otp: null, categorys: [] }, /unknown key "categorys"/],
    ['empty categories', { categories: [], otp: null }, /non-empty array/],
    ['a non-category', { categories: ['Promotion'], otp: null }, /"Promotion" is not a category/],
    ['a missing otp', { categories: ['Travel'] }, /"otp" must be a string or null/],
    ['a numeric otp', { categories: ['Travel'], otp: 483920 }, /"otp" must be a string or null/],
    ['a non-string note', { categories: ['Travel'], otp: null, note: 3 }, /"note" must be a string/],
  ])('rejects %s, naming the file', (_name, raw, message) => {
    expect(() => parseIntent(raw, '/x/intent.json')).toThrow(message)
    expect(() => parseIntent(raw, '/x/intent.json')).toThrow('/x/intent.json')
  })
})

describe('readIntent', () => {
  it('returns null when there is no file', () => {
    expect(readIntent(null)).toBeNull()
  })

  it('names the file when the JSON is malformed', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'intent-')), 'intent.json')
    fs.writeFileSync(file, '{oops')

    expect(() => readIntent(file)).toThrow(/is not valid JSON/)
  })
})

describe('intentDisagreements', () => {
  it('reports nothing when the baseline matches the intent', () => {
    expect(intentDisagreements({ categories: ['Travel'], otp: null }, snap())).toEqual([])
  })

  it('compares categories as a set, ignoring order', () => {
    const baseline = snap({ categories: ['Urgent', 'Finance'] })

    expect(intentDisagreements({ categories: ['Finance', 'Urgent'], otp: null }, baseline)).toEqual([])
  })

  it('reports a category disagreement', () => {
    expect(intentDisagreements({ categories: ['Finance', 'Urgent'], otp: null }, snap({ categories: ['Finance'] }))).toEqual([
      'categories: intended ["Finance","Urgent"], baseline ["Finance"]',
    ])
  })

  it('reports an OTP stored where none was intended, and the reverse', () => {
    expect(intentDisagreements({ categories: ['Travel'], otp: null }, snap({ extractedOtp: 'HK7X2M' }))).toEqual([
      'otp: intended null, baseline "HK7X2M"',
    ])
    expect(intentDisagreements({ categories: ['Security'], otp: '482917' }, snap({ categories: ['Security'] }))).toEqual([
      'otp: intended "482917", baseline null',
    ])
  })

  it('skips categories when the baseline has none (a withoutLlm-only baseline: the LLM never ran)', () => {
    expect(intentDisagreements({ categories: ['Travel'], otp: null }, snap({ categories: [] }))).toEqual([])
  })

  it('does not skip categories for a withLlm baseline whose most common answer was "none"', () => {
    const observed = {
      categories: [{ value: [] as string[], count: 3 }, { value: ['Travel'], count: 2 }],
      extractedOtp: [{ value: null, count: 5 }],
      links: {},
    }

    expect(intentDisagreements({ categories: ['Travel'], otp: null }, { ...snap({ categories: [] }), observed })).toEqual([
      'categories: intended ["Travel"], baseline []',
    ])
  })
})
