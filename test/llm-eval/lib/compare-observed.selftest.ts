import { describe, expect, it } from 'vitest'
import { compareSection, compareWithObserved } from './compare-observed'
import { aggregateSamples } from './observed'
import type { Snapshot, StoredSection } from './types'

const VIEW = 'https://x.example/view'
const TRACK = 'https://x.example/track'

const link = (url: string, isCta: boolean, ctaConfidence: 'high' | 'low' = 'high') => ({
  url,
  label: url.split('/').pop(),
  isCta,
  ctaConfidence,
})

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  extractedOtp: null,
  categories: ['Receipts'],
  metadata: { links: [link(VIEW, true), link(TRACK, true)], timestamps: [] },
  ...over,
})

const withTrack = (isCta: boolean) =>
  snap({ metadata: { links: [link(VIEW, true), link(TRACK, isCta)], timestamps: [] } })

/** A baseline of 4 samples: track was judged a CTA 3 times, and once not. */
const baseline = (): StoredSection & { observed: NonNullable<StoredSection['observed']> } => {
  const { snapshot, samples, observed } = aggregateSamples([
    withTrack(true),
    withTrack(true),
    withTrack(true),
    withTrack(false),
  ])
  return { ...snapshot, samples, observed }
}

describe('compareWithObserved', () => {
  it('passes an answer that matches the mode, with no warnings', () => {
    expect(compareWithObserved(baseline(), withTrack(true))).toEqual({ failures: [], informational: [], warnings: [] })
  })

  it('passes a minority answer the baseline saw, and warns that it was rare', () => {
    const result = compareWithObserved(baseline(), withTrack(false))

    expect(result.failures).toEqual([])
    expect(result.warnings).toEqual([
      `metadata.links[${TRACK}]: {"isCta":false,"ctaConfidence":"high"} was seen in 1/4 baseline samples`,
    ])
  })

  it('does not warn when the answer was seen in exactly half the samples', () => {
    const { snapshot, samples, observed } = aggregateSamples([withTrack(true), withTrack(false)])

    expect(compareWithObserved({ ...snapshot, samples, observed }, withTrack(false)).warnings).toEqual([])
  })

  it('fails on categories the baseline never saw, listing what it did see', () => {
    const { failures } = compareWithObserved(baseline(), snap({ categories: ['Primary'] }))

    expect(failures).toEqual([{ path: 'categories', expected: [['Receipts']], actual: ['Primary'] }])
  })

  it('compares categories as a set', () => {
    const stored = aggregateSamples([snap({ categories: ['Finance', 'Urgent'] })])
    const section = { ...stored.snapshot, samples: stored.samples, observed: stored.observed }

    expect(compareWithObserved(section, snap({ categories: ['Urgent', 'Finance'] })).failures).toEqual([])
  })

  it('fails on an OTP the baseline never saw', () => {
    expect(compareWithObserved(baseline(), snap({ extractedOtp: 'HK7X2M' })).failures).toEqual([
      { path: 'extractedOtp', expected: [null], actual: 'HK7X2M' },
    ])
  })

  it('fails on a link state the baseline never saw', () => {
    const actual = snap({ metadata: { links: [link(VIEW, true), link(TRACK, false, 'low')], timestamps: [] } })

    expect(compareWithObserved(baseline(), actual).failures).toEqual([
      {
        path: `metadata.links[${TRACK}]`,
        expected: [
          { isCta: true, ctaConfidence: 'high' },
          { isCta: false, ctaConfidence: 'high' },
        ],
        actual: { isCta: false, ctaConfidence: 'low' },
      },
    ])
  })

  it('fails when a link appeared, disappeared or changed its label', () => {
    const extra = snap({
      metadata: { links: [link(VIEW, true), link(TRACK, true), link('https://x.example/new', true)], timestamps: [] },
    })
    const missing = snap({ metadata: { links: [link(VIEW, true)], timestamps: [] } })
    const relabelled = snap({
      metadata: { links: [link(VIEW, true), { ...link(TRACK, true), label: 'Track it' }], timestamps: [] },
    })

    expect(compareWithObserved(baseline(), extra).failures.map((f) => f.path)).toEqual([
      'metadata.links[https://x.example/new]',
    ])
    expect(compareWithObserved(baseline(), missing).failures.map((f) => f.path)).toEqual([`metadata.links[${TRACK}]`])
    expect(compareWithObserved(baseline(), relabelled).failures.map((f) => f.path)).toEqual([
      `metadata.links[${TRACK}].label`,
    ])
  })

  it('reports timestamps informationally and never fails on them', () => {
    const actual = snap({ metadata: { links: [link(VIEW, true), link(TRACK, true)], timestamps: ['Friday'] } })
    const result = compareWithObserved(baseline(), actual)

    expect(result.failures).toEqual([])
    expect(result.informational).toEqual([{ path: 'metadata.timestamps[0]', expected: undefined, actual: 'Friday' }])
  })
})

describe('compareSection', () => {
  it('uses the observed comparison for a withLlm section that has observed answers', () => {
    expect(compareSection('withLlm', baseline(), withTrack(false)).failures).toEqual([])
  })

  it('falls back to the strict legacy comparison for a withLlm section with no observed answers', () => {
    const legacy: StoredSection = snap()

    expect(compareSection('withLlm', legacy, withTrack(false)).failures).toEqual([
      { path: 'metadata.links[1].isCta', expected: true, actual: false },
    ])
  })

  it('is always strict for withoutLlm, even if a section somehow carries observed answers', () => {
    expect(compareSection('withoutLlm', baseline(), withTrack(false)).failures.length).toBeGreaterThan(0)
  })
})
