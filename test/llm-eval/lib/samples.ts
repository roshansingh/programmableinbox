/** The most provider runs a withLlm baseline may take. Sampling usually stops sooner (see PATIENCE). */
export const DEFAULT_SAMPLES = 30

/**
 * How many consecutive samples must add no new answer before a baseline is
 * considered saturated. A fully stable case therefore costs 1 + PATIENCE
 * samples; a noisy one keeps going, up to the maximum. This puts the effort
 * where the variance is: a fixed count of 5 left about 15% of freshly
 * baselined cases failing on the very next run, because the model's rarer
 * answers had simply not been drawn yet.
 */
export const PATIENCE = 8

/** Extra attempts a failing withLlm comparison gets before it is reported as a failure. */
export const DEFAULT_RETRIES = 2

/**
 * `EVAL_SAMPLES`: the most provider runs a withLlm baseline may take. Parsed
 * from a string handed in, so no `process.env` read lives in a library module.
 * Bounded so a typo cannot turn one command into hundreds of API calls.
 */
export function parseSamples(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_SAMPLES
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 50) {
    throw new Error(`EVAL_SAMPLES must be a whole number from 1 to 50, got ${JSON.stringify(raw)}`)
  }
  return n
}

/** `EVAL_RETRIES`: 0 turns retrying off. */
export function parseRetries(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_RETRIES
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0 || n > 5) {
    throw new Error(`EVAL_RETRIES must be a whole number from 0 to 5, got ${JSON.stringify(raw)}`)
  }
  return n
}

/**
 * Run `once` n times, one after another (the recorder and row store are shared
 * singletons, so runs cannot overlap), and return every result. All-or-nothing:
 * the first rejection propagates, so a caller can never build a baseline from a
 * partial set.
 */
export async function collectSamples<T>(n: number, once: (index: number) => Promise<T>): Promise<T[]> {
  const results: T[] = []
  for (let i = 0; i < n; i += 1) results.push(await once(i))
  return results
}

/**
 * Like collectSamples, but stops early once the answers have saturated: after
 * `patience` consecutive samples in which no answer key (see `keysOf`) had been
 * seen before. The first sample is always novel, so the cheapest possible run
 * is 1 + patience samples. Never exceeds `max`. Same all-or-nothing behaviour.
 */
export async function collectUntilStable<T>(
  options: { max: number; patience: number },
  once: (index: number) => Promise<T>,
  keysOf: (result: T) => string[],
): Promise<T[]> {
  const results: T[] = []
  const seen = new Set<string>()
  let sinceNew = 0
  for (let i = 0; i < options.max; i += 1) {
    const result = await once(i)
    results.push(result)
    let novel = false
    for (const key of keysOf(result)) {
      if (!seen.has(key)) {
        seen.add(key)
        novel = true
      }
    }
    sinceNew = novel ? 0 : sinceNew + 1
    if (sinceNew >= options.patience) break
  }
  return results
}
