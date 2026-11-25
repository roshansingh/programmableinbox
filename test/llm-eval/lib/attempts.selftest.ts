import { describe, expect, it } from 'vitest'
import { compareWithRetries } from './attempts'
import type { Comparison, Diff } from './types'

const diff = (path: string): Diff => ({ path, expected: 'a', actual: 'b' })
const pass = (over: Partial<Comparison> = {}): Comparison => ({ failures: [], informational: [], ...over })
const fail = (...paths: string[]): Comparison => ({ failures: paths.map(diff), informational: [] })

/** A `once` that returns the given comparisons in order. */
const script = (...results: Comparison[]) => {
  let i = 0
  return async () => results[Math.min(i++, results.length - 1)]
}

describe('compareWithRetries', () => {
  it('passes on the first attempt without any warning about retrying', async () => {
    const result = await compareWithRetries(2, script(pass()))

    expect(result).toEqual({ comparison: pass(), attempts: 1 })
  })

  it('does not retry when retrying is off, and returns the failure', async () => {
    let calls = 0
    const result = await compareWithRetries(0, async () => {
      calls += 1
      return fail('categories')
    })

    expect(calls).toBe(1)
    expect(result.comparison.failures.map((d) => d.path)).toEqual(['categories'])
  })

  it('passes when a later attempt passes, and warns which attempt and what failed earlier', async () => {
    const result = await compareWithRetries(2, script(fail('categories'), pass()))

    expect(result.attempts).toBe(2)
    expect(result.comparison.failures).toEqual([])
    expect(result.comparison.warnings).toEqual(['passed on attempt 2 of 3; attempt 1 failed on: categories'])
  })

  it('keeps warnings the passing attempt already had', async () => {
    const result = await compareWithRetries(2, script(fail('extractedOtp'), pass({ warnings: ['rare answer'] })))

    expect(result.comparison.warnings).toEqual(['rare answer', 'passed on attempt 2 of 3; attempt 1 failed on: extractedOtp'])
  })

  it('fails only when every attempt fails, reporting the last attempt and how many were made', async () => {
    let calls = 0
    const result = await compareWithRetries(2, async () => {
      calls += 1
      return fail(`path-${calls}`)
    })

    expect(calls).toBe(3)
    expect(result.attempts).toBe(3)
    expect(result.comparison.failures.map((d) => d.path)).toEqual(['path-3'])
    expect(result.comparison.warnings).toEqual(['failed on all 3 attempts'])
  })

  it('lists every failing path from an earlier attempt, not just the first', async () => {
    const result = await compareWithRetries(1, script(fail('categories', 'extractedOtp'), pass()))

    expect(result.comparison.warnings).toEqual(['passed on attempt 2 of 2; attempt 1 failed on: categories, extractedOtp'])
  })

  it('propagates an error thrown by an attempt instead of swallowing it', async () => {
    await expect(
      compareWithRetries(2, async () => {
        throw new Error('provider down')
      }),
    ).rejects.toThrow('provider down')
  })
})
