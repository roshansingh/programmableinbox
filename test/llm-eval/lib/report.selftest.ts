import { describe, expect, it } from 'vitest'
import { Report } from './report'
import type { RunRecord } from './types'

const rec = (over: Partial<RunRecord>): RunRecord => ({
  caseId: 'otp',
  mode: 'withoutLlm',
  status: 'pass',
  failures: [],
  informational: [],
  notes: [],
  ...over,
})

describe('Report.counts / hasFailures', () => {
  it('counts each status per mode', () => {
    const report = new Report()
    report.record(rec({ caseId: 'a', status: 'pass' }))
    report.record(rec({ caseId: 'b', status: 'fail' }))
    report.record(rec({ caseId: 'a', mode: 'withLlm', status: 'generated' }))
    report.record(rec({ caseId: 'b', mode: 'withLlm', status: 'skipped' }))

    expect(report.counts('withoutLlm')).toEqual({ pass: 1, fail: 1, generated: 0, skipped: 0 })
    expect(report.counts('withLlm')).toEqual({ pass: 0, fail: 0, generated: 1, skipped: 1 })
  })

  it('reports failures only when a run failed', () => {
    const report = new Report()
    report.record(rec({ status: 'generated' }))
    expect(report.hasFailures()).toBe(false)

    report.record(rec({ caseId: 'b', status: 'fail' }))
    expect(report.hasFailures()).toBe(true)
  })
})

describe('Report.render', () => {
  it('says so when nothing ran', () => {
    expect(new Report().render()).toContain('No cases ran.')
  })

  it('shows one line per case with both runs, and totals per run', () => {
    const report = new Report()
    report.record(rec({ caseId: 'security/otp', mode: 'withoutLlm', status: 'pass' }))
    report.record(rec({ caseId: 'security/otp', mode: 'withLlm', status: 'fail' }))
    report.record(rec({ caseId: 'promo', mode: 'withoutLlm', status: 'generated' }))
    report.record(rec({ caseId: 'promo', mode: 'withLlm', status: 'skipped' }))

    const text = report.render()

    expect(text).toMatch(/security\/otp\s+withoutLlm PASS\s+withLlm FAIL/)
    expect(text).toMatch(/promo\s+withoutLlm GENERATED\s+withLlm SKIPPED/)
    expect(text).toMatch(/withoutLlm\s+1 pass · 0 fail · 1 generated · 0 skipped/)
    expect(text).toMatch(/withLlm\s+0 pass · 1 fail · 0 generated · 1 skipped/)
  })

  it('prints each failure with its diffs, informational diffs and notes', () => {
    const report = new Report()
    report.record(
      rec({
        caseId: 'security/otp',
        mode: 'withLlm',
        status: 'fail',
        failures: [{ path: 'extractedOtp', expected: '483920', actual: null }],
        informational: [{ path: 'metadata.timestamps[0]', expected: undefined, actual: 'in 10 minutes' }],
        notes: ['llm proposed: otp=null'],
      }),
    )

    const text = report.render()

    expect(text).toContain('FAIL  security/otp [withLlm]')
    expect(text).toContain('extractedOtp: expected "483920" → actual null')
    expect(text).toContain('(informational) metadata.timestamps[0]: expected <missing> → actual "in 10 minutes"')
    expect(text).toContain('llm proposed: otp=null')
  })

  it('does not print details for passing runs', () => {
    const report = new Report()
    report.record(rec({ status: 'pass', notes: ['should not appear'] }))

    expect(report.render()).not.toContain('should not appear')
  })

  it('lists generated files and reminds the reader to review them', () => {
    const report = new Report()
    report.record(rec({ caseId: 'promo', status: 'generated', notes: ['wrote cases/promo/output.json'] }))

    const text = report.render()

    expect(text).toContain('GENERATED  promo [withoutLlm]')
    expect(text).toContain('wrote cases/promo/output.json')
    expect(text).toContain('need a human review')
  })

  it('summarises skipped runs once instead of once per case', () => {
    const report = new Report()
    for (const caseId of ['a', 'b', 'c']) {
      report.record(rec({ caseId, mode: 'withLlm', status: 'skipped', notes: ['LLM not configured'] }))
    }

    const text = report.render()

    expect(text.match(/Skipped 3 run\(s\): LLM not configured/g)).toHaveLength(1)
    expect(text).not.toContain('SKIPPED  a [withLlm]')
  })
})
