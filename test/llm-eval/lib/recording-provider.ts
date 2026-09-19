import type { CandidateLink, EnrichOptions, LLMProvider, LlmEnrichmentResult } from '@/lib/llm/types'

export interface ProviderCall {
  subject: string
  options: EnrichOptions | undefined
  result: LlmEnrichmentResult
}

/**
 * What the real provider was asked and answered. `enrichMessage` swallows
 * provider errors (it returns `false` and logs), so without this the runner
 * could not tell "the model found nothing" from "the API key was wrong" — and
 * would generate a bogus baseline from the second.
 */
export class ProviderRecorder {
  calls: ProviderCall[] = []
  errors: string[] = []

  reset(): void {
    this.calls = []
    this.errors = []
  }

  last(): ProviderCall | undefined {
    return this.calls[this.calls.length - 1]
  }
}

export function recordingProvider(inner: LLMProvider, recorder: ProviderRecorder): LLMProvider {
  return {
    async enrich(subject: string, bodyText: string, candidateLinks: CandidateLink[], options?: EnrichOptions) {
      try {
        const result = await inner.enrich(subject, bodyText, candidateLinks, options)
        recorder.calls.push({ subject, options, result })
        return result
      } catch (error) {
        recorder.errors.push(error instanceof Error ? error.message : String(error))
        throw error
      }
    },
  }
}
