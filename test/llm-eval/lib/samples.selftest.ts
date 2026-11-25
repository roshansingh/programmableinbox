import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RETRIES,
  DEFAULT_SAMPLES,
  PATIENCE,
  collectSamples,
  collectUntilStable,
  parseRetries,
  parseSamples,
} from './samples'

describe('parseSamples', () => {
  it('defaults to 30 (a maximum, not a fixed count) when unset or blank', () => {
    expect(DEFAULT_SAMPLES).toBe(30)
    expect(parseSamples(undefined)).toBe(30)
    expect(parseSamples('  ')).toBe(30)
  })

  it('accepts a whole number from 1 to 50', () => {
    expect(parseSamples('1')).toBe(1)
    expect(parseSamples('50')).toBe(50)
  })

  it.each(['0', '-1', '2.5', 'abc', '51', '5 samples'])('rejects %s, naming the variable', (raw) => {
    expect(() => parseSamples(raw)).toThrow(/EVAL_SAMPLES must be a whole number from 1 to 50/)
  })
})

describe('parseRetries', () => {
  it('defaults to 2 when unset or blank', () => {
    expect(DEFAULT_RETRIES).toBe(2)
    expect(parseRetries(undefined)).toBe(2)
    expect(parseRetries('')).toBe(2)
  })

  it('accepts a whole number from 0 to 5, where 0 turns retrying off', () => {
    expect(parseRetries('0')).toBe(0)
    expect(parseRetries('5')).toBe(5)
  })

  it.each(['-1', '6', '1.5', 'many'])('rejects %s, naming the variable', (raw) => {
    expect(() => parseRetries(raw)).toThrow(/EVAL_RETRIES must be a whole number from 0 to 5/)
  })
})

describe('collectSamples', () => {
  it('runs sequentially, in order, passing the index', async () => {
    const log: string[] = []
    const results = await collectSamples(3, async (i) => {
      log.push(`start ${i}`)
      await new Promise((resolve) => setTimeout(resolve, 5 - i))
      log.push(`end ${i}`)
      return i * 10
    })

    expect(results).toEqual([0, 10, 20])
    expect(log).toEqual(['start 0', 'end 0', 'start 1', 'end 1', 'start 2', 'end 2'])
  })

  it('is all-or-nothing: the first failure propagates and no partial set is returned', async () => {
    let calls = 0
    await expect(
      collectSamples(5, async (i) => {
        calls += 1
        if (i === 2) throw new Error('provider down')
        return i
      }),
    ).rejects.toThrow('provider down')
    expect(calls).toBe(3)
  })
})

describe('collectUntilStable', () => {
  const keys = (answer: string) => [answer]

  it('stops once `patience` consecutive samples add nothing new: a stable case costs 1 + patience samples', async () => {
    let calls = 0
    const results = await collectUntilStable({ max: 30, patience: 3 }, async () => {
      calls += 1
      return 'same'
    }, keys)

    expect(calls).toBe(4)
    expect(results).toHaveLength(4)
  })

  it('a new answer resets the patience counter', async () => {
    const script = ['a', 'a', 'b', 'a', 'a', 'a', 'a']
    const results = await collectUntilStable({ max: 30, patience: 3 }, async (i) => script[i], keys)

    // 'b' first appears at index 2, so three more samples with nothing new end it at index 5.
    expect(results).toEqual(['a', 'a', 'b', 'a', 'a', 'a'])
  })

  it('counts a new key in ANY field as novelty, not only the first', async () => {
    const script = [['x', 'y'], ['x', 'y'], ['x', 'z'], ['x', 'y'], ['x', 'y']]
    const results = await collectUntilStable({ max: 30, patience: 2 }, async (i) => script[i], (r) => r)

    expect(results).toHaveLength(5)
  })

  it('never exceeds max, however noisy the answers are', async () => {
    let calls = 0
    const results = await collectUntilStable({ max: 6, patience: 3 }, async (i) => {
      calls += 1
      return `answer-${i}`
    }, keys)

    expect(calls).toBe(6)
    expect(results).toHaveLength(6)
  })

  it('is all-or-nothing: a failure propagates and no partial set is returned', async () => {
    await expect(
      collectUntilStable({ max: 10, patience: 3 }, async (i) => {
        if (i === 1) throw new Error('provider down')
        return 'x'
      }, keys),
    ).rejects.toThrow('provider down')
  })

  it('exposes the patience the runner uses', () => {
    expect(PATIENCE).toBe(8)
  })
})
