import { describe, expect, it } from 'vitest'
import { classifyLlmRun } from './run-outcome'

const call = (categories: string[]) => ({ result: { categories } })

describe('classifyLlmRun', () => {
  it('is ok when enrichment settled after exactly one provider call', () => {
    expect(classifyLlmRun({ settled: true, errors: [], calls: [call(['Notifications'])] })).toEqual({ kind: 'ok' })
  })

  it('records "the model answered with no valid categories" as an outcome, not a failure', () => {
    // enrichMessage throws when the (filtered) category list is empty and returns false,
    // but the provider itself answered: production retries this, the eval records it.
    expect(classifyLlmRun({ settled: false, errors: [], calls: [call([])] })).toEqual({ kind: 'no-categories' })
  })

  it('fails on a provider error, whatever else happened, and says what it was', () => {
    expect(classifyLlmRun({ settled: false, errors: ['401 bad key', '429 slow down'], calls: [] })).toEqual({
      kind: 'failed',
      reason: '401 bad key; 429 slow down',
    })
    expect(classifyLlmRun({ settled: true, errors: ['boom'], calls: [call(['Primary'])] }).kind).toBe('failed')
  })

  it('fails when the provider was never reached', () => {
    const outcome = classifyLlmRun({ settled: false, errors: [], calls: [] })

    expect(outcome.kind).toBe('failed')
    expect(outcome).toMatchObject({ reason: expect.stringContaining('provider was never reached') })
  })

  it('fails when it did not settle for a reason other than an empty answer', () => {
    const outcome = classifyLlmRun({ settled: false, errors: [], calls: [call(['Primary'])] })

    expect(outcome).toMatchObject({ kind: 'failed', reason: expect.stringContaining('did not settle') })
  })

  it('fails when a settled run made more or fewer than one provider call', () => {
    const outcome = classifyLlmRun({ settled: true, errors: [], calls: [call(['Primary']), call(['Primary'])] })

    expect(outcome).toMatchObject({ kind: 'failed', reason: expect.stringContaining('exactly one provider call') })
  })
})
