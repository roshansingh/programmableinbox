export const DEFAULT_SAMPLES = 5

/**
 * `EVAL_SAMPLES`: how many provider runs make up a withLlm baseline. Parsed
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
