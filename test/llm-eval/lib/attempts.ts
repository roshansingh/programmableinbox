import type { Comparison } from './types'

/**
 * Confirm before failing. A stochastic model occasionally draws an answer its
 * baseline never saw (a skipped link judgement, an extra category) without
 * anything having regressed; measured, that failed about 15% of freshly
 * baselined cases on the very next run. A real regression is consistent, so a
 * comparison is repeated up to `retries` more times and reported as a failure
 * only if *every* attempt fails. A pass after a failure is kept visible as a
 * warning, never hidden.
 *
 * This trades some sensitivity for signal: a change that makes the model give
 * an unseen answer only some of the time can slip through. `retries: 0`
 * restores strict single-attempt behaviour.
 *
 * An error thrown by an attempt (a provider failure) is not retried: it
 * propagates.
 */
export async function compareWithRetries(
  retries: number,
  once: () => Promise<Comparison>,
): Promise<{ comparison: Comparison; attempts: number }> {
  const total = 1 + retries
  const earlier: string[][] = []
  let last!: Comparison

  for (let attempt = 1; attempt <= total; attempt += 1) {
    last = await once()
    if (last.failures.length === 0) {
      if (attempt === 1) return { comparison: last, attempts: 1 }
      const failed = earlier.map((paths, i) => `attempt ${i + 1} failed on: ${paths.join(', ')}`).join('; ')
      return {
        comparison: { ...last, warnings: [...(last.warnings ?? []), `passed on attempt ${attempt} of ${total}; ${failed}`] },
        attempts: attempt,
      }
    }
    earlier.push(last.failures.map((failure) => failure.path))
  }

  return {
    comparison: { ...last, warnings: [...(last.warnings ?? []), ...(total > 1 ? [`failed on all ${total} attempts`] : [])] },
    attempts: total,
  }
}
