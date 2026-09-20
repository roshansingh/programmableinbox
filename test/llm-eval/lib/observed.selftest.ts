import { describe, expect, it } from 'vitest'
import { aggregateSamples, unstableFields } from './observed'
import type { Snapshot } from './types'

const link = (url: string, isCta: boolean, ctaConfidence: 'high' | 'low' = 'high') => ({
  url,
  label: url.split('/').pop(),
  isCta,
  ctaConfidence,
})

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  extractedOtp: null,
  categories: ['Receipts'],
  metadata: { links: [link('https://x.example/view', true)], timestamps: ['Friday'] },
  ...over,
})

describe('aggregateSamples', () => {
  it('throws on no samples', () => {
    expect(() => aggregateSamples([])).toThrow(/at least one sample/)
  })

  it('a unanimous set has one answer per field, each counted', () => {
    const { snapshot, samples, observed } = aggregateSamples([snap(), snap(), snap()])

    expect(samples).toBe(3)
    expect(observed.categories).toEqual([{ value: ['Receipts'], count: 3 }])
    expect(observed.extractedOtp).toEqual([{ value: null, count: 3 }])
    expect(observed.links['https://x.example/view']).toEqual([
      { value: { isCta: true, ctaConfidence: 'high' }, count: 3 },
    ])
    expect(snapshot).toEqual(snap())
  })

  it('stores the most frequent answer as the snapshot and lists every answer by count', () => {
    const { snapshot, observed } = aggregateSamples([
      snap({ categories: ['Security'] }),
      snap({ categories: ['Primary', 'Security'] }),
      snap({ categories: ['Security'] }),
    ])

    expect(snapshot.categories).toEqual(['Security'])
    expect(observed.categories).toEqual([
      { value: ['Security'], count: 2 },
      { value: ['Primary', 'Security'], count: 1 },
    ])
  })

  it('treats categories as sets: order and duplicates do not create a new answer', () => {
    const { observed } = aggregateSamples([
      snap({ categories: ['Urgent', 'Finance'] }),
      snap({ categories: ['Finance', 'Urgent', 'Finance'] }),
    ])

    expect(observed.categories).toEqual([{ value: ['Finance', 'Urgent'], count: 2 }])
  })

  it('breaks a tie deterministically by the smaller JSON encoding', () => {
    const forward = aggregateSamples([snap({ extractedOtp: 'B22222' }), snap({ extractedOtp: 'A11111' })])
    const backward = aggregateSamples([snap({ extractedOtp: 'A11111' }), snap({ extractedOtp: 'B22222' })])

    expect(forward.snapshot.extractedOtp).toBe('A11111')
    expect(backward.snapshot.extractedOtp).toBe('A11111')
  })

  it('takes each link its own mode, so one flip does not change the others', () => {
    const a = link('https://x.example/view', true)
    const b = link('https://x.example/track', true)
    const { snapshot, observed } = aggregateSamples([
      snap({ metadata: { links: [a, b], timestamps: [] } }),
      snap({ metadata: { links: [a, { ...b, isCta: false }], timestamps: [] } }),
      snap({ metadata: { links: [a, { ...b, isCta: false }], timestamps: [] } }),
    ])

    expect(snapshot.metadata.links.map((l) => [l.url, l.isCta])).toEqual([
      ['https://x.example/view', true],
      ['https://x.example/track', false],
    ])
    expect(observed.links['https://x.example/track']).toEqual([
      { value: { isCta: false, ctaConfidence: 'high' }, count: 2 },
      { value: { isCta: true, ctaConfidence: 'high' }, count: 1 },
    ])
  })

  it('keeps link labels and order from the first sample, and its timestamps', () => {
    const { snapshot } = aggregateSamples([
      snap({ metadata: { links: [link('https://x.example/view', true)], timestamps: ['first'] } }),
      snap({ metadata: { links: [link('https://x.example/view', true)], timestamps: ['second'] } }),
    ])

    expect(snapshot.metadata.timestamps).toEqual(['first'])
    expect(snapshot.metadata.links[0].label).toBe('view')
  })
})

describe('unstableFields', () => {
  it('is empty when every field had one answer', () => {
    expect(unstableFields(aggregateSamples([snap(), snap()]).observed)).toEqual([])
  })

  it('names each field that had more than one answer', () => {
    const flip = snap({
      categories: ['Primary', 'Receipts'],
      extractedOtp: 'A11111',
      metadata: { links: [link('https://x.example/view', false)], timestamps: [] },
    })

    expect(unstableFields(aggregateSamples([snap(), flip]).observed)).toEqual([
      'categories (2 answers)',
      'extractedOtp (2 answers)',
      'metadata.links[https://x.example/view] (2 answers)',
    ])
  })
})
