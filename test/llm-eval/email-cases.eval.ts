import fs from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { enrichMessage } from '@/lib/llm/enrichment'
import { resetProviderCache } from '@/lib/llm/factory'
import { buildRow, toSnapshot } from './lib/build-row'
import { compareSnapshots, formatDiff } from './lib/compare'
import { discoverCases } from './lib/discover'
import { Report } from './lib/report'
import { recorder, store } from './lib/shared'
import { planAction, readStoredOutput, toSection, writeSection } from './lib/stored-output'
import { RUN_MODES } from './lib/types'
import type { CaseDir, RunMode, RunRecord } from './lib/types'

// The one thing faked: the Prisma calls enrichMessage makes (see
// lib/row-store.ts for exactly which). Everything else — extraction, prompt,
// provider adapter, acceptLlmOtp, the Security gate, the CTA merge — is the
// real code.
vi.mock('@/lib/db', async () => {
  const { store } = await import('./lib/shared')
  return { prisma: store.prismaShim() }
})

// Wrap whatever the real factory builds (or null, when no provider is
// configured) so the runner can see what the model was asked and answered.
vi.mock('@/lib/llm/factory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/llm/factory')>()
  const { recorder } = await import('./lib/shared')
  const { recordingProvider } = await import('./lib/recording-provider')
  return {
    ...actual,
    getProvider: () => {
      const inner = actual.getProvider()
      return inner ? recordingProvider(inner, recorder) : null
    },
  }
})

const CASES_ROOT = path.resolve(__dirname, 'cases')
const LLM_ENV_KEYS = ['LLM_PROVIDER', 'LLM_API_KEY', 'LLM_MODEL', 'LLM_BASE_URL'] as const
type LlmEnvKey = (typeof LLM_ENV_KEYS)[number]

// Snapshot the configured LLM environment once, up front, so each run can turn
// it on or off without losing it.
const configuredLlmEnv = Object.fromEntries(
  LLM_ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<LlmEnvKey, string | undefined>
// Mirrors lib/config/schema.ts: every provider except ollama needs an API key.
// "Provider set, key blank" (an unedited .env.eval.example) is treated as not
// configured: otherwise config would throw inside enrichMessage, which
// swallows it and would surface as a misleading failure.
const llmProvider = configuredLlmEnv.LLM_PROVIDER
const llmConfigured =
  Boolean(llmProvider) && (llmProvider === 'ollama' || Boolean(configuredLlmEnv.LLM_API_KEY?.trim()))
const llmSkipNote =
  llmProvider && !llmConfigured
    ? `LLM_PROVIDER=${llmProvider} is set but LLM_API_KEY is empty (set it in .env.eval)`
    : 'LLM not configured: set LLM_PROVIDER (and LLM_API_KEY) in .env.eval'
const update = process.env.EVAL_UPDATE === '1'
const modelLabel = `${configuredLlmEnv.LLM_PROVIDER ?? 'none'}:${configuredLlmEnv.LLM_MODEL ?? 'default'}`

const report = new Report()
let runToken = 0

function setLlm(enabled: boolean): void {
  for (const key of LLM_ENV_KEYS) {
    const value = configuredLlmEnv[key]
    if (enabled && value !== undefined) process.env[key] = value
    else delete process.env[key]
  }
  // Config is memoised per domain; clearing the provider cache clears it too.
  resetProviderCache()
}

/**
 * enrichMessage swallows provider errors and returns `false`, so a bad API key
 * would otherwise look like "the model found nothing" and generate a bogus
 * baseline. Refuse to record a run that is not what its label claims.
 */
function assertRunIsGenuine(mode: RunMode, settled: boolean): void {
  if (mode === 'withoutLlm') {
    if (recorder.calls.length > 0 || recorder.errors.length > 0) {
      throw new Error(
        'The "withoutLlm" run reached the LLM provider: LLM_* leaked into it, so it is not a deterministic-only baseline.',
      )
    }
    return
  }
  if (!settled || recorder.errors.length > 0) {
    // Most specific cause first: a provider error the recorder saw; else the
    // provider was never called (getProvider threw on bad config, which
    // enrichMessage swallows); else it was called and the result was unusable.
    const reason =
      recorder.errors.length > 0
        ? recorder.errors.join('; ')
        : recorder.calls.length === 0
          ? 'the provider was never reached — check the LLM_PROVIDER / LLM_API_KEY / LLM_BASE_URL configuration'
          : 'the model returned no categories, or the write failed'
    throw new Error(
      `LLM enrichment did not complete: ${reason.replace(/\.+$/, '')}. Nothing was written to output.json.`,
    )
  }
  if (recorder.calls.length !== 1) {
    throw new Error(
      `Expected exactly one provider call in the "withLlm" run, saw ${recorder.calls.length}. Is LLM_PROVIDER valid?`,
    )
  }
}

function llmNotes(bodyText: string | null): string[] {
  const call = recorder.last()
  const notes: string[] = []
  if (call) {
    const r = call.result
    notes.push(
      `llm proposed: otp=${JSON.stringify(r.otp)} evidence=${JSON.stringify(r.otpEvidence)} ` +
        `categories=${JSON.stringify(r.categories)} (otp requested: ${call.options?.extractOtp === true})`,
    )
  }
  notes.push(`body text seen: ${JSON.stringify((bodyText ?? '').slice(0, 200))}`)
  return notes
}

/**
 * Every (case, mode) that executes is recorded exactly once, including runs
 * that throw: a failure that only reached Vitest's error output would leave the
 * printed report (per-case lines and totals) saying nothing failed. The inner
 * function records through `record`, so the catch below can tell whether a
 * record already exists (a compare failure records, then throws) and never
 * adds a second one.
 */
async function runCase(c: CaseDir, mode: RunMode, skip: () => void): Promise<void> {
  let recorded = false
  const record = (run: RunRecord): void => {
    recorded = true
    report.record(run)
  }
  try {
    await runCaseBody(c, mode, skip, record)
  } catch (error) {
    if (!recorded) {
      record({
        caseId: c.id,
        mode,
        status: 'fail',
        failures: [],
        informational: [],
        notes: [error instanceof Error ? error.message : String(error)],
      })
    }
    throw error
  }
}

async function runCaseBody(
  c: CaseDir,
  mode: RunMode,
  skip: () => void,
  record: (run: RunRecord) => void,
): Promise<void> {
  const stored = readStoredOutput(c.outputPath)
  const action = planAction({ stored, mode, llmConfigured, update })
  const relOutput = path.relative(process.cwd(), c.outputPath)

  if (action === 'skip') {
    record({
      caseId: c.id,
      mode,
      status: 'skipped',
      failures: [],
      informational: [],
      notes: [llmSkipNote],
    })
    skip()
    return
  }

  // Vitest fails a timed-out test but does not cancel its promise, so a run can
  // resume after the next test has reset the shared recorder and store. The
  // token lets it notice it was superseded before it can read that state.
  const token = ++runToken

  setLlm(mode === 'withLlm')
  recorder.reset()
  store.clear()

  const row = buildRow({
    id: `${c.id}:${mode}`,
    caseId: c.id,
    html: fs.readFileSync(c.htmlPath, 'utf8'),
  })
  store.insert(row)

  const settled = await enrichMessage(row.id)
  if (token !== runToken) {
    throw new Error(
      `${c.id} [${mode}]: this run was superseded, most likely by a timeout, and its result was discarded. Nothing was written to output.json.`,
    )
  }
  assertRunIsGenuine(mode, settled)

  const actual = toSnapshot(store.get(row.id)!)
  const notes = llmNotes(row.bodyText)

  if (action === 'generate') {
    writeSection(
      c.outputPath,
      mode,
      toSection(actual, { at: new Date().toISOString(), model: mode === 'withLlm' ? modelLabel : null }),
    )
    record({
      caseId: c.id,
      mode,
      status: 'generated',
      failures: [],
      informational: [],
      notes: [`wrote ${relOutput}`, ...notes],
    })
    return
  }

  const expected = stored?.[mode]
  if (!expected) throw new Error(`unreachable: "compare" planned without a stored ${mode} section`)

  const { failures, informational } = compareSnapshots(mode, expected, actual)
  const failed = failures.length > 0
  record({ caseId: c.id, mode, status: failed ? 'fail' : 'pass', failures, informational, notes })

  if (failed) {
    throw new Error(
      [`${c.id} [${mode}] differs from ${relOutput}:`, ...failures.map((d) => `  ${formatDiff(d)}`)].join('\n'),
    )
  }
}

const cases = discoverCases(CASES_ROOT)

describe('email extraction cases', () => {
  // console.log is swallowed under this setup; stdout.write is not.
  afterAll(() => {
    process.stdout.write(`${report.render()}\n`)
  })

  it('has at least one case folder', () => {
    expect(cases.length, `no case folders under ${CASES_ROOT}`).toBeGreaterThan(0)
  })

  for (const c of cases) {
    describe(c.id, () => {
      for (const mode of RUN_MODES) {
        it(mode, async (ctx) => {
          await runCase(c, mode, () => ctx.skip())
        })
      }
    })
  }
})
