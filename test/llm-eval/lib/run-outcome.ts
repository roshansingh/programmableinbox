export type RunOutcome =
  /** Enrichment settled after exactly one provider call. */
  | { kind: 'ok' }
  /**
   * The provider answered, but with no category the pipeline accepts (typically
   * a name that is not in the list, e.g. "Correspondence"). Production treats
   * this as a transient failure and retries; the eval records it as one of the
   * model's possible answers, because at a real rate (~1 in 6 for a plain-text
   * notification, measured) refusing it would make such a case impossible to
   * baseline.
   */
  | { kind: 'no-categories' }
  /** Nothing trustworthy to record: a provider error, a misconfiguration, a broken harness. */
  | { kind: 'failed'; reason: string }

export interface LlmRunEvidence {
  settled: boolean
  /** Errors the provider threw, as the recorder saw them. */
  errors: readonly string[]
  /** What the provider returned, one entry per call. */
  calls: readonly { result: { categories: readonly string[] } }[]
}

/**
 * enrichMessage swallows provider errors and returns `false`, so a bad API key
 * would otherwise read as "the model found nothing" and generate a bogus
 * baseline. This separates the cases that must never be recorded (a provider
 * error, an unreachable provider) from the one that is a legitimate model
 * behaviour (an answer with no valid category).
 */
export function classifyLlmRun(run: LlmRunEvidence): RunOutcome {
  if (run.errors.length > 0) return { kind: 'failed', reason: run.errors.join('; ') }
  if (run.calls.length === 0) {
    return {
      kind: 'failed',
      reason: 'the provider was never reached — check the LLM_PROVIDER / LLM_API_KEY / LLM_BASE_URL configuration',
    }
  }
  if (run.settled) {
    return run.calls.length === 1
      ? { kind: 'ok' }
      : {
          kind: 'failed',
          reason: `Expected exactly one provider call in the "withLlm" run, saw ${run.calls.length}. Is LLM_PROVIDER valid?`,
        }
  }
  if (run.calls.length === 1 && run.calls[0].result.categories.length === 0) return { kind: 'no-categories' }
  return { kind: 'failed', reason: 'enrichment did not settle although the model returned categories, so the write failed' }
}
