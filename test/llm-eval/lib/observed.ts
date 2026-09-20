import type { Counted, LinkState, Observed, Snapshot } from './types'

const sortedSet = (values: readonly string[]): string[] => [...new Set(values)].sort()

/**
 * Tally values by their JSON encoding: highest count first, ties broken by the
 * smaller encoding. The first entry is therefore a deterministic mode, so
 * regenerating a baseline from the same samples yields the same file.
 */
function tally<T>(values: T[]): Counted<T>[] {
  const byKey = new Map<string, Counted<T>>()
  for (const value of values) {
    const key = JSON.stringify(value)
    const entry = byKey.get(key)
    if (entry) entry.count += 1
    else byKey.set(key, { value, count: 1 })
  }
  return [...byKey.entries()]
    .sort(([ka, a], [kb, b]) => b.count - a.count || (ka < kb ? -1 : ka > kb ? 1 : 0))
    .map(([, entry]) => entry)
}

/**
 * Collapse N snapshots of one case into what is stored: the mode of each field
 * as an ordinary snapshot (readable, and what a legacy reader would see) plus
 * every observed answer. The mode is per field — each link's own mode — never a
 * whole-sample vote, which would need identical answers across every field.
 */
export function aggregateSamples(samples: Snapshot[]): { snapshot: Snapshot; samples: number; observed: Observed } {
  if (samples.length === 0) throw new Error('aggregateSamples needs at least one sample')

  const categories = tally(samples.map((sample) => sortedSet(sample.categories)))
  const extractedOtp = tally(samples.map((sample) => sample.extractedOtp))

  const states = new Map<string, LinkState[]>()
  for (const sample of samples) {
    for (const link of sample.metadata.links) {
      const list = states.get(link.url) ?? []
      list.push({ isCta: link.isCta, ctaConfidence: link.ctaConfidence })
      states.set(link.url, list)
    }
  }
  const links: Record<string, Counted<LinkState>[]> = {}
  for (const [url, list] of states) links[url] = tally(list)

  const first = samples[0]
  const snapshot: Snapshot = {
    extractedOtp: extractedOtp[0].value,
    categories: categories[0].value,
    metadata: {
      links: first.metadata.links.map((link) => ({ ...link, ...links[link.url][0].value })),
      timestamps: [...first.metadata.timestamps],
    },
  }
  return { snapshot, samples: samples.length, observed: { categories, extractedOtp, links } }
}

/** The fields the model did not answer consistently while the baseline was generated. */
export function unstableFields(observed: Observed): string[] {
  const fields: string[] = []
  if (observed.categories.length > 1) fields.push(`categories (${observed.categories.length} answers)`)
  if (observed.extractedOtp.length > 1) fields.push(`extractedOtp (${observed.extractedOtp.length} answers)`)
  for (const [url, answers] of Object.entries(observed.links)) {
    if (answers.length > 1) fields.push(`metadata.links[${url}] (${answers.length} answers)`)
  }
  return fields
}
