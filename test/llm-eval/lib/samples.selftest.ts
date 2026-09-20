import { describe, expect, it } from 'vitest'
import { DEFAULT_SAMPLES, collectSamples, parseSamples } from './samples'

describe('parseSamples', () => {
  it('defaults to 5 when unset or blank', () => {
    expect(DEFAULT_SAMPLES).toBe(5)
    expect(parseSamples(undefined)).toBe(5)
    expect(parseSamples('  ')).toBe(5)
  })

  it('accepts a whole number from 1 to 50', () => {
    expect(parseSamples('1')).toBe(1)
    expect(parseSamples('50')).toBe(50)
  })

  it.each(['0', '-1', '2.5', 'abc', '51', '5 samples'])('rejects %s, naming the variable', (raw) => {
    expect(() => parseSamples(raw)).toThrow(/EVAL_SAMPLES must be a whole number from 1 to 50/)
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
