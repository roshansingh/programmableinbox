import { describe, expect, it } from 'vitest'
import { scoreRun, summarize, type BenchRef, type BenchRun } from './bench'
import { aggregateSamples } from './observed'
import type { Snapshot } from './types'

const URL_A = 'https://x.example/a'
const link = (url: string, isCta: boolean, ctaConfidence: 'high' | 'low' = 'high') => ({ url, label: 'l', isCta, ctaConfidence })

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  extractedOtp: null,
  categories: ['Security'],
  metadata: { links: [link(URL_A, true)], timestamps: [] },
  ...over,
})

/** A baseline where the model said Security 3 times and Security+Urgent once; link A judged a CTA every time. */
const baseline = () => {
  const { snapshot, samples, observed } = aggregateSamples([
    snap(),
    snap(),
    snap(),
    snap({ categories: ['Security', 'Urgent'] }),
  ])
  return { ...snapshot, samples, observed }
}

const ref = (over: Partial<BenchRef> = {}): BenchRef => ({
  intent: { categories: ['Security'], otp: null },
  baseline: baseline(),
  ...over,
})

const run = (over: Partial<BenchRun> = {}): BenchRun => ({
  caseId: 'c',
  outcome: 'ok',
  ms: 100,
  promptTokens: 800,
  completionTokens: 60,
  snapshot: snap(),
  regexOtp: null,
  lowUrls: [URL_A],
  ...over,
})

describe('scoreRun: categories', () => {
  it('scores a perfect run', () => {
    const s = scoreRun(run(), ref())

    expect(s).toMatchObject({
      usable: true,
      categoriesSeen: true,
      categoriesMode: true,
      categoriesIntent: true,
      coversIntent: true,
    })
  })

  it('counts a set the baseline saw only rarely as seen, but not the mode', () => {
    const s = scoreRun(run({ snapshot: snap({ categories: ['Urgent', 'Security'] }) }), ref())

    expect(s).toMatchObject({ categoriesSeen: true, categoriesMode: false, categoriesIntent: false, coversIntent: true })
  })

  it('counts a set the baseline never saw as unseen', () => {
    const s = scoreRun(run({ snapshot: snap({ categories: ['Promotions'] }) }), ref())

    expect(s).toMatchObject({ categoriesSeen: false, categoriesMode: false, categoriesIntent: false, coversIntent: false })
  })

  it('treats category order as irrelevant', () => {
    const s = scoreRun(run({ snapshot: snap({ categories: ['Security', 'Urgent'] }) }), ref())

    expect(s.categoriesSeen).toBe(true)
  })

  it.each(['no-categories', 'failed', 'timeout'] as const)('scores nothing for a %s run, and marks it unusable', (outcome) => {
    const s = scoreRun(run({ outcome, snapshot: null }), ref())

    expect(s).toMatchObject({
      usable: false,
      categoriesSeen: false,
      categoriesMode: false,
      categoriesIntent: false,
      coversIntent: false,
      otpMatchesBaseline: false,
      linksAgree: 0,
    })
  })

  it('has no opinion where there is no baseline or no intent', () => {
    const s = scoreRun(run(), ref({ baseline: null, intent: null }))

    expect(s).toMatchObject({ usable: true, categoriesSeen: false, categoriesMode: false, categoriesIntent: false })
  })
})

describe('scoreRun: OTP', () => {
  it('a code the regex already found is not the model\'s doing', () => {
    const s = scoreRun(
      run({ regexOtp: '483920', snapshot: snap({ extractedOtp: '483920' }) }),
      ref({ intent: { categories: ['Security'], otp: '483920' } }),
    )

    expect(s).toMatchObject({ llmAsked: false, llmFalseOtp: false, llmWrongOtp: false, recoverable: false })
  })

  it('flags a code the LLM path stored where none was intended', () => {
    const s = scoreRun(run({ snapshot: snap({ extractedOtp: '202020' }) }), ref())

    expect(s).toMatchObject({ llmAsked: true, llmFalseOtp: true, llmWrongOtp: false })
  })

  it('flags a wrong code where a different one was intended', () => {
    const s = scoreRun(
      run({ snapshot: snap({ extractedOtp: '112233' }) }),
      ref({ intent: { categories: ['Security'], otp: '771204' } }),
    )

    expect(s).toMatchObject({ llmFalseOtp: false, llmWrongOtp: true, recovered: false, recoverable: true })
  })

  it('counts a recovered code', () => {
    const s = scoreRun(
      run({ snapshot: snap({ extractedOtp: 'A1B2C3' }) }),
      ref({ intent: { categories: ['Security'], otp: 'A1B2C3' } }),
    )

    expect(s).toMatchObject({ recoverable: true, recovered: true, llmFalseOtp: false, llmWrongOtp: false })
  })

  it('compares the stored code with the baseline, independently of intent', () => {
    const matches = scoreRun(run({ snapshot: snap({ extractedOtp: null }) }), ref())
    const differs = scoreRun(run({ snapshot: snap({ extractedOtp: 'X9' }) }), ref())

    expect(matches.otpMatchesBaseline).toBe(true)
    expect(differs.otpMatchesBaseline).toBe(false)
  })
})

describe('scoreRun: links', () => {
  it('counts a judged link the baseline saw as agreeing', () => {
    expect(scoreRun(run(), ref())).toMatchObject({ linksJudged: 1, linksAgree: 1, linksSkipped: 0 })
  })

  it('counts a link left low-confidence as skipped, and it does not agree', () => {
    const s = scoreRun(run({ snapshot: snap({ metadata: { links: [link(URL_A, false, 'low')], timestamps: [] } }) }), ref())

    expect(s).toMatchObject({ linksJudged: 1, linksAgree: 0, linksSkipped: 1 })
  })

  it('counts a judgement the baseline never saw as not agreeing, without calling it skipped', () => {
    const s = scoreRun(run({ snapshot: snap({ metadata: { links: [link(URL_A, false, 'high')], timestamps: [] } }) }), ref())

    expect(s).toMatchObject({ linksJudged: 1, linksAgree: 0, linksSkipped: 0 })
  })

  it('has no low-confidence links to judge when the heuristic decided them all', () => {
    expect(scoreRun(run({ lowUrls: [] }), ref())).toMatchObject({ linksJudged: 0, linksAgree: 0, linksSkipped: 0 })
  })
})

describe('summarize', () => {
  const refs = { a: ref(), b: ref(), c: ref(), d: ref() }

  it('counts outcomes, and unusable runs count against every rate', () => {
    const summary = summarize(
      [
        run({ caseId: 'a' }),
        run({ caseId: 'b', outcome: 'no-categories', snapshot: null }),
        run({ caseId: 'c', outcome: 'failed', snapshot: null, reason: 'truncated' }),
        run({ caseId: 'd', outcome: 'timeout', snapshot: null }),
      ],
      refs,
    )

    expect(summary).toMatchObject({ cases: 4, usable: 1, noCategories: 1, failed: 1, timeout: 1, categoriesIntent: 1 })
  })

  it('totals the model-attributable OTP outcomes and link judgements', () => {
    const summary = summarize(
      [
        run({ caseId: 'a', snapshot: snap({ extractedOtp: '202020' }) }),
        run({ caseId: 'b' }),
        run({ caseId: 'c', snapshot: snap({ metadata: { links: [link(URL_A, false, 'low')], timestamps: [] } }) }),
      ],
      refs,
    )

    expect(summary).toMatchObject({ llmAsked: 3, llmFalseOtp: 1, linksJudged: 3, linksAgree: 2, linksSkipped: 1 })
  })

  it('computes latency percentiles by nearest rank, ignoring timeouts', () => {
    const runs = [100, 200, 300, 400, 1000].map((ms, i) => run({ caseId: 'a', ms }))
    runs.push(run({ caseId: 'a', ms: 99999, outcome: 'timeout', snapshot: null }))

    const { latency } = summarize(runs, refs)

    expect(latency).toEqual({ medianMs: 300, p95Ms: 1000, meanMs: 400, totalMs: 2000 })
  })

  it('averages token counts over the runs that reported them', () => {
    const { tokens } = summarize(
      [
        run({ caseId: 'a', promptTokens: 800, completionTokens: 50 }),
        run({ caseId: 'b', promptTokens: 1000, completionTokens: 70 }),
        run({ caseId: 'c', promptTokens: null, completionTokens: null }),
      ],
      refs,
    )

    expect(tokens).toEqual({ meanPrompt: 900, meanCompletion: 60 })
  })

  it('reports null latency and tokens when nothing ran', () => {
    const empty = summarize([], refs)

    expect(empty.latency).toEqual({ medianMs: null, p95Ms: null, meanMs: null, totalMs: 0 })
    expect(empty.tokens).toEqual({ meanPrompt: null, meanCompletion: null })
  })
})
