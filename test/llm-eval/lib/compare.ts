import type { Comparison, Diff, RunMode, Snapshot } from './types'

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Leaf-level differences between two JSON-like values. Object keys that start
 * with an underscore (the `_generated` provenance block) are ignored at every
 * depth. A value present on only one side is reported with `undefined` on the
 * other.
 */
export function diffValues(expected: unknown, actual: unknown, path = ''): Diff[] {
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const length = Math.max(expected.length, actual.length)
    return Array.from({ length }, (_, i) => diffValues(expected[i], actual[i], `${path}[${i}]`)).flat()
  }
  if (isPlainObject(expected) && isPlainObject(actual)) {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
      .filter((key) => !key.startsWith('_'))
      .sort()
    return keys.flatMap((key) => diffValues(expected[key], actual[key], path ? `${path}.${key}` : key))
  }
  return Object.is(expected, actual) ? [] : [{ path, expected, actual }]
}

const asSortedSet = (value: unknown): unknown =>
  Array.isArray(value) ? [...new Set(value.map(String))].sort() : value

/**
 * The comparison rules.
 *  - withoutLlm: fully deterministic, so any difference fails.
 *  - withLlm: strict on the fields the model does not decide freely
 *    (extractedOtp, links), an unordered-set comparison for categories, and
 *    timestamps are printed but never fail — the model words them freely.
 */
export function compareSnapshots(mode: RunMode, expected: Snapshot, actual: Snapshot): Comparison {
  if (mode === 'withoutLlm') {
    return { failures: diffValues(expected, actual), informational: [] }
  }

  const failures: Diff[] = [
    ...diffValues(expected.extractedOtp, actual.extractedOtp, 'extractedOtp'),
    ...diffValues(expected.metadata?.links, actual.metadata?.links, 'metadata.links'),
  ]

  const expectedCategories = asSortedSet(expected.categories)
  const actualCategories = asSortedSet(actual.categories)
  if (JSON.stringify(expectedCategories) !== JSON.stringify(actualCategories)) {
    failures.push({ path: 'categories', expected: expectedCategories, actual: actualCategories })
  }

  return {
    failures,
    informational: diffValues(expected.metadata?.timestamps, actual.metadata?.timestamps, 'metadata.timestamps'),
  }
}

const show = (value: unknown): string => (value === undefined ? '<missing>' : JSON.stringify(value))

export function formatDiff(diff: Diff): string {
  return `${diff.path || '(root)'}: expected ${show(diff.expected)} → actual ${show(diff.actual)}`
}
