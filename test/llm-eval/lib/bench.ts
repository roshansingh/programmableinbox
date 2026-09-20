import type { Intent } from './intent'
import type { Snapshot, StoredSection } from './types'

export type BenchOutcome = 'ok' | 'no-categories' | 'failed' | 'timeout'

/** One model's answer to one case, as measured by the benchmark runner. */
export interface BenchRun {
  caseId: string
  outcome: BenchOutcome
  /** Why a `failed` run failed (a truncated response, a provider error). */
  reason?: string
  /** Wall-clock time of the whole enrichMessage call. */
  ms: number
  promptTokens: number | null
  completionTokens: number | null
  /** Present for `ok` and `no-categories`; the row as enrichment left it. */
  snapshot: Snapshot | null
  /** What the deterministic regex extracted. When null, the LLM fallback was asked for a code. */
  regexOtp: string | null
  /** The links the heuristic left low-confidence: the ones the model is asked to judge. */
  lowUrls: string[]
}

/** What a run is measured against: the author's intent, and the gpt-4o-mini baseline. */
export interface BenchRef {
  intent: Intent | null
  baseline: StoredSection | null
}

export interface RunScore {
  usable: boolean
  /** Category set is one the gpt-4o-mini baseline saw (the eval's own pass rule). */
  categoriesSeen: boolean
  /** Category set equals the baseline's most common answer. */
  categoriesMode: boolean
  /** Category set is exactly what the author intended. */
  categoriesIntent: boolean
  /** Every intended category is present (extra tags allowed). */
  coversIntent: boolean
  /** The stored OTP equals the baseline's. */
  otpMatchesBaseline: boolean
  /** The regex found nothing, so the model's OTP fallback was asked. */
  llmAsked: boolean
  /** The model path stored a code where none was intended: the unsafe outcome. */
  llmFalseOtp: boolean
  /** The model path stored a code that is not the intended one. */
  llmWrongOtp: boolean
  /** The regex found nothing, but a code was intended: the model could have recovered it. */
  recoverable: boolean
  recovered: boolean
  linksJudged: number
  /** Links whose final state is one the baseline saw. */
  linksAgree: number
  /** Links the model left unjudged (still low-confidence). */
  linksSkipped: number
}

const sortedSet = (values: readonly string[]): string[] => [...new Set(values)].sort()
const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  JSON.stringify(sortedSet(a)) === JSON.stringify(sortedSet(b))

export function scoreRun(run: BenchRun, ref: BenchRef): RunScore {
  const usable = run.outcome === 'ok'
  const snapshot = usable ? run.snapshot : null
  const { intent, baseline } = ref

  const categories = snapshot ? sortedSet(snapshot.categories) : null
  const otp = snapshot ? snapshot.extractedOtp : null
  const llmAsked = run.regexOtp === null

  let categoriesSeen = false
  if (categories && baseline) {
    categoriesSeen = baseline.observed
      ? baseline.observed.categories.some((answer) => sameSet(answer.value, categories))
      : sameSet(baseline.categories, categories)
  }

  let linksAgree = 0
  let linksSkipped = 0
  if (snapshot) {
    const finalByUrl = new Map(snapshot.metadata.links.map((l) => [l.url, l]))
    for (const url of run.lowUrls) {
      const final = finalByUrl.get(url)
      if (!final) continue
      if (final.ctaConfidence === 'low') linksSkipped += 1
      const seen = baseline?.observed?.links[url]
      if (seen?.some((a) => a.value.isCta === final.isCta && a.value.ctaConfidence === final.ctaConfidence)) linksAgree += 1
    }
  }

  const recoverable = llmAsked && intent !== null && intent.otp !== null
  return {
    usable,
    categoriesSeen,
    categoriesMode: !!(categories && baseline && sameSet(baseline.categories, categories)),
    categoriesIntent: !!(categories && intent && sameSet(intent.categories, categories)),
    coversIntent: !!(categories && intent && intent.categories.every((c) => categories.includes(c))),
    otpMatchesBaseline: !!(snapshot && baseline && otp === baseline.extractedOtp),
    llmAsked,
    llmFalseOtp: usable && llmAsked && otp !== null && intent !== null && intent.otp === null,
    llmWrongOtp: usable && llmAsked && otp !== null && intent !== null && intent.otp !== null && otp !== intent.otp,
    recoverable,
    recovered: usable && recoverable && otp === intent!.otp,
    linksJudged: run.lowUrls.length,
    linksAgree,
    linksSkipped,
  }
}

export interface BenchSummary {
  cases: number
  usable: number
  noCategories: number
  failed: number
  timeout: number
  categoriesSeen: number
  categoriesMode: number
  categoriesIntent: number
  coversIntent: number
  otpMatchesBaseline: number
  llmAsked: number
  llmFalseOtp: number
  llmWrongOtp: number
  recoverable: number
  recovered: number
  linksJudged: number
  linksAgree: number
  linksSkipped: number
  latency: { medianMs: number | null; p95Ms: number | null; meanMs: number | null; totalMs: number }
  tokens: { meanPrompt: number | null; meanCompletion: number | null }
}

const mean = (values: number[]): number | null =>
  values.length === 0 ? null : Math.round(values.reduce((sum, v) => sum + v, 0) / values.length)

/** Nearest-rank percentile of an ascending list. */
const percentile = (sorted: number[], p: number): number | null =>
  sorted.length === 0 ? null : sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]

/**
 * Totals across a model's runs. Every count is out of `cases` (or, for OTP and
 * links, out of the stated denominator), and an unusable run (no valid
 * category, a provider failure, a timeout) scores as a miss on every rate, so a
 * model cannot look good by failing to answer.
 */
export function summarize(runs: BenchRun[], refs: Record<string, BenchRef>): BenchSummary {
  const summary: BenchSummary = {
    cases: runs.length,
    usable: 0,
    noCategories: 0,
    failed: 0,
    timeout: 0,
    categoriesSeen: 0,
    categoriesMode: 0,
    categoriesIntent: 0,
    coversIntent: 0,
    otpMatchesBaseline: 0,
    llmAsked: 0,
    llmFalseOtp: 0,
    llmWrongOtp: 0,
    recoverable: 0,
    recovered: 0,
    linksJudged: 0,
    linksAgree: 0,
    linksSkipped: 0,
    latency: { medianMs: null, p95Ms: null, meanMs: null, totalMs: 0 },
    tokens: { meanPrompt: null, meanCompletion: null },
  }

  for (const run of runs) {
    const score = scoreRun(run, refs[run.caseId] ?? { intent: null, baseline: null })
    if (run.outcome === 'ok') summary.usable += 1
    else if (run.outcome === 'no-categories') summary.noCategories += 1
    else if (run.outcome === 'failed') summary.failed += 1
    else summary.timeout += 1
    for (const key of [
      'categoriesSeen',
      'categoriesMode',
      'categoriesIntent',
      'coversIntent',
      'otpMatchesBaseline',
      'llmAsked',
      'llmFalseOtp',
      'llmWrongOtp',
      'recoverable',
      'recovered',
    ] as const) {
      if (score[key]) summary[key] += 1
    }
    summary.linksJudged += score.linksJudged
    summary.linksAgree += score.linksAgree
    summary.linksSkipped += score.linksSkipped
  }

  const timed = runs.filter((run) => run.outcome !== 'timeout').map((run) => run.ms)
  const sorted = [...timed].sort((a, b) => a - b)
  summary.latency = {
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    meanMs: mean(timed),
    totalMs: timed.reduce((sum, v) => sum + v, 0),
  }
  summary.tokens = {
    meanPrompt: mean(runs.flatMap((run) => (run.promptTokens === null ? [] : [run.promptTokens]))),
    meanCompletion: mean(runs.flatMap((run) => (run.completionTokens === null ? [] : [run.completionTokens]))),
  }
  return summary
}
