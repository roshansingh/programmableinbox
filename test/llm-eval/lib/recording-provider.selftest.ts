import { describe, expect, it } from 'vitest'
import { ProviderRecorder, recordingProvider } from './recording-provider'
import type { LLMProvider, LlmEnrichmentResult } from '@/lib/llm/types'

const RESULT: LlmEnrichmentResult = {
  categories: ['Security'],
  ctaJudgments: [],
  timestamps: [],
  otp: '483920',
  otpEvidence: 'Your verification code is 483920',
}

describe('recordingProvider', () => {
  it('passes every argument through and records the call with its result', async () => {
    const seen: unknown[][] = []
    const inner: LLMProvider = {
      async enrich(...args) {
        seen.push(args)
        return RESULT
      },
    }
    const recorder = new ProviderRecorder()

    const result = await recordingProvider(inner, recorder).enrich(
      'Subject',
      'Body',
      [{ url: 'https://example.com' }],
      { extractOtp: true },
    )

    expect(result).toBe(RESULT)
    expect(seen).toEqual([['Subject', 'Body', [{ url: 'https://example.com' }], { extractOtp: true }]])
    expect(recorder.calls).toEqual([{ subject: 'Subject', options: { extractOtp: true }, result: RESULT }])
    expect(recorder.last()?.result).toBe(RESULT)
  })

  it('records the error message and rethrows, so enrichMessage still sees the failure', async () => {
    const inner: LLMProvider = {
      async enrich() {
        throw new Error('401 invalid api key')
      },
    }
    const recorder = new ProviderRecorder()

    await expect(recordingProvider(inner, recorder).enrich('s', 'b', [])).rejects.toThrow('401 invalid api key')

    expect(recorder.errors).toEqual(['401 invalid api key'])
    expect(recorder.calls).toEqual([])
  })

  it('reset clears calls and errors', async () => {
    const recorder = new ProviderRecorder()
    recorder.errors.push('x')
    recorder.calls.push({ subject: 's', options: undefined, result: RESULT })

    recorder.reset()

    expect(recorder.calls).toEqual([])
    expect(recorder.errors).toEqual([])
    expect(recorder.last()).toBeUndefined()
  })
})
