import { describe, expect, it } from 'vitest'
import { compareSnapshots, diffValues, formatDiff } from './compare'
import type { Snapshot } from './types'

const link = {
  url: 'https://example.com/verify',
  label: 'Verify email',
  isCta: true,
  ctaConfidence: 'high' as const,
}

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  extractedOtp: '483920',
  categories: ['Security'],
  metadata: { links: [link], timestamps: [] },
  ...over,
})

describe('diffValues', () => {
  it('reports nothing for equal values', () => {
    expect(diffValues(snap(), snap())).toEqual([])
  })

  it('reports a changed primitive with its path', () => {
    expect(diffValues({ a: { b: 1 } }, { a: { b: 2 } })).toEqual([
      { path: 'a.b', expected: 1, actual: 2 },
    ])
  })

  it('reports a nested change inside an array element', () => {
    const changed = snap({ metadata: { links: [{ ...link, isCta: false }], timestamps: [] } })

    expect(diffValues(snap(), changed)).toEqual([
      { path: 'metadata.links[0].isCta', expected: true, actual: false },
    ])
  })

  it('reports an extra and a missing array element', () => {
    expect(diffValues([1, 2], [1])).toEqual([{ path: '[1]', expected: 2, actual: undefined }])
    expect(diffValues([1], [1, 2])).toEqual([{ path: '[1]', expected: undefined, actual: 2 }])
  })

  it('distinguishes null from a value', () => {
    expect(diffValues({ otp: null }, { otp: '1234' })).toEqual([
      { path: 'otp', expected: null, actual: '1234' },
    ])
  })

  it('ignores keys that start with an underscore, at any depth', () => {
    expect(diffValues({ _generated: { at: 'x' }, a: 1 }, { a: 1 })).toEqual([])
  })
})

describe('compareSnapshots: withoutLlm is fully strict', () => {
  it('passes on identical snapshots', () => {
    expect(compareSnapshots('withoutLlm', snap(), snap())).toEqual({ failures: [], informational: [] })
  })

  it.each([
    ['otp', snap({ extractedOtp: null })],
    ['categories', snap({ categories: ['Primary'] })],
    ['timestamps', snap({ metadata: { links: [link], timestamps: ['tomorrow'] } })],
    ['links', snap({ metadata: { links: [], timestamps: [] } })],
  ])('fails when %s differs', (_name, actual) => {
    expect(compareSnapshots('withoutLlm', snap(), actual).failures.length).toBeGreaterThan(0)
  })
})

describe('compareSnapshots: withLlm is strict on stable fields, tolerant on LLM ones', () => {
  it('fails when extractedOtp differs', () => {
    const { failures } = compareSnapshots('withLlm', snap(), snap({ extractedOtp: null }))

    expect(failures).toEqual([{ path: 'extractedOtp', expected: '483920', actual: null }])
  })

  it('fails when a link changes', () => {
    const actual = snap({ metadata: { links: [{ ...link, isCta: false }], timestamps: [] } })

    expect(compareSnapshots('withLlm', snap(), actual).failures).toEqual([
      { path: 'metadata.links[0].isCta', expected: true, actual: false },
    ])
  })

  it('treats categories as an unordered set', () => {
    const expected = snap({ categories: ['Security', 'Notifications'] })
    const actual = snap({ categories: ['Notifications', 'Security'] })

    expect(compareSnapshots('withLlm', expected, actual)).toEqual({ failures: [], informational: [] })
  })

  it('fails when the category set differs, showing both sets sorted', () => {
    const { failures } = compareSnapshots('withLlm', snap(), snap({ categories: ['Promotions', 'Primary'] }))

    expect(failures).toEqual([
      { path: 'categories', expected: ['Security'], actual: ['Primary', 'Promotions'] },
    ])
  })

  it('reports timestamp differences as informational only', () => {
    const actual = snap({ metadata: { links: [link], timestamps: ['in 10 minutes'] } })

    const result = compareSnapshots('withLlm', snap(), actual)

    expect(result.failures).toEqual([])
    expect(result.informational).toEqual([
      { path: 'metadata.timestamps[0]', expected: undefined, actual: 'in 10 minutes' },
    ])
  })

  it('ignores the _generated provenance block on the stored side', () => {
    const stored = { ...snap(), _generated: { at: '2026-09-18T00:00:00.000Z', model: 'anthropic:x' } }

    expect(compareSnapshots('withLlm', stored, snap())).toEqual({ failures: [], informational: [] })
  })
})

describe('formatDiff', () => {
  it('shows path, expected and actual', () => {
    expect(formatDiff({ path: 'extractedOtp', expected: '483920', actual: null })).toBe(
      'extractedOtp: expected "483920" → actual null',
    )
  })

  it('marks a missing side', () => {
    expect(formatDiff({ path: '[1]', expected: undefined, actual: 2 })).toBe(
      '[1]: expected <missing> → actual 2',
    )
  })

  it('names the root when the path is empty', () => {
    expect(formatDiff({ path: '', expected: 1, actual: 2 })).toBe('(root): expected 1 → actual 2')
  })
})
