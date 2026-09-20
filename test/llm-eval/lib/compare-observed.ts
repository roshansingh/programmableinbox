import { compareSnapshots, diffValues } from './compare'
import type { Comparison, Counted, Diff, Observed, RunMode, Snapshot, StoredSection } from './types'

/** An accepted answer seen in fewer than this share of baseline samples is flagged. */
const RARE_BELOW = 0.5

const sortedSet = (values: readonly string[]): string[] => [...new Set(values)].sort()

/**
 * The withLlm comparison for a baseline that recorded several samples.
 *
 * A field passes when its value is one the baseline saw, per field rather than
 * per whole snapshot: with a handful of samples the joint combinations are
 * sparse, and a whole-snapshot rule would bring back the run-to-run flakiness
 * this exists to remove. Anything the baseline never saw fails.
 *
 * This detects new behaviour, not a shift in probability: an answer moving from
 * 80% to 30% of runs still passes, and only the rarity warning notices.
 */
export function compareWithObserved(
  stored: StoredSection & { observed: Observed },
  actual: Snapshot,
): Comparison {
  const failures: Diff[] = []
  const warnings: string[] = []

  const check = <T>(path: string, answers: Counted<T>[], value: T): void => {
    const key = JSON.stringify(value)
    const match = answers.find((answer) => JSON.stringify(answer.value) === key)
    if (!match) {
      failures.push({ path, expected: answers.map((answer) => answer.value), actual: value })
      return
    }
    const total = answers.reduce((sum, answer) => sum + answer.count, 0)
    if (match.count / total < RARE_BELOW) {
      warnings.push(`${path}: ${key} was seen in ${match.count}/${total} baseline samples`)
    }
  }

  check('categories', stored.observed.categories, sortedSet(actual.categories))
  check('extractedOtp', stored.observed.extractedOtp, actual.extractedOtp)

  const storedLinks = new Map(stored.metadata.links.map((link) => [link.url, link]))
  const actualUrls = new Set(actual.metadata.links.map((link) => link.url))

  for (const link of actual.metadata.links) {
    const path = `metadata.links[${link.url}]`
    const answers = stored.observed.links[link.url]
    const base = storedLinks.get(link.url)
    if (!answers || !base) {
      failures.push({ path, expected: undefined, actual: link })
      continue
    }
    // Labels come from the email, not the model: any change is an extractor change.
    if (base.label !== link.label) failures.push({ path: `${path}.label`, expected: base.label, actual: link.label })
    check(path, answers, { isCta: link.isCta, ctaConfidence: link.ctaConfidence })
  }
  for (const [url, base] of storedLinks) {
    if (!actualUrls.has(url)) failures.push({ path: `metadata.links[${url}]`, expected: base, actual: undefined })
  }

  return {
    failures,
    informational: diffValues(stored.metadata?.timestamps, actual.metadata?.timestamps, 'metadata.timestamps'),
    warnings,
  }
}

/** The one entry point the runner uses: observed answers when the baseline has them, the strict comparison otherwise. */
export function compareSection(mode: RunMode, stored: StoredSection, actual: Snapshot): Comparison {
  if (mode === 'withLlm' && stored.observed) {
    return compareWithObserved({ ...stored, observed: stored.observed }, actual)
  }
  return compareSnapshots(mode, stored, actual)
}
