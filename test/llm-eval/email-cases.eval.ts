import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { enrichMessage } from '@/lib/llm/enrichment'
import { resetProviderCache } from '@/lib/llm/factory'
import { compareWithRetries } from './lib/attempts'
import { buildRow, toSnapshot } from './lib/build-row'
import { readCaseInput } from './lib/case-input'
import { formatDiff } from './lib/compare'
import { compareSection } from './lib/compare-observed'
import { discoverCases } from './lib/discover'
import { intentDisagreements, readIntent } from './lib/intent'
import { resolveLlmPreflight } from './lib/llm-preflight'
import { aggregateSamples, answerKeys, unstableFields } from './lib/observed'
import { Report } from './lib/report'
import { classifyLlmRun } from './lib/run-outcome'
import { PATIENCE, collectSamples, collectUntilStable, parseRetries, parseSamples } from './lib/samples'
import { recorder, store } from './lib/shared'
import { planAction, readStoredOutput, toSection, writeSection } from './lib/stored-output'
import { RUN_MODES } from './lib/types'
import type { CaseDir, RunMode, RunRecord, Snapshot, StoredSection } from './lib/types'

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
const preflight = resolveLlmPreflight(configuredLlmEnv)
const llmConfigured = preflight.status === 'configured'
const llmSkipNote = preflight.note
const update = process.env.EVAL_UPDATE === '1'
// A withLlm baseline is many samples, not one: gpt-4o-mini disagrees with its
// own single-sample baseline often enough to leave most runs red. Sampling
// stops once PATIENCE consecutive samples add no new answer, and never exceeds
// `samples`.
const samples = parseSamples(process.env.EVAL_SAMPLES)
// A failing withLlm comparison is repeated this many more times before it is
// reported: a rare draw from the model's normal tail is not a regression.
const retries = parseRetries(process.env.EVAL_RETRIES)
// vitest.eval.config.ts allows this long for one provider call.
const CALL_TIMEOUT_MS = 120_000
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
 * baseline. Refuse to record a run that is not what its label claims (see
 * classifyLlmRun). The one exception is a model that answered but gave no valid
 * category: that is a possible answer, so it is returned, not thrown.
 */
function assertRunIsGenuine(mode: RunMode, settled: boolean): 'ok' | 'no-categories' {
  if (mode === 'withoutLlm') {
    if (recorder.calls.length > 0 || recorder.errors.length > 0) {
      throw new Error(
        'The "withoutLlm" run reached the LLM provider: LLM_* leaked into it, so it is not a deterministic-only baseline.',
      )
    }
    return 'ok'
  }
  const outcome = classifyLlmRun({ settled, errors: recorder.errors, calls: recorder.calls })
  if (outcome.kind === 'failed') {
    throw new Error(
      `LLM enrichment did not complete: ${outcome.reason.replace(/\.+$/, '')}. Nothing was written to output.json.`,
    )
  }
  return outcome.kind
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
  // Before planAction: an invalid provider must fail here, not fall into its
  // "not configured" skip, or a typo in LLM_PROVIDER reads as a healthy run.
  if (mode === 'withLlm' && preflight.status === 'invalid') {
    throw new Error(`${c.id} [withLlm]: ${preflight.note}. Fix it in .env.eval.`)
  }

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
  const input = readCaseInput(c)

  // One full ingestion + enrichment pass over a fresh row. Sequential by
  // design: the recorder and the row store are shared singletons.
  const runOnce = async (): Promise<{ actual: Snapshot; bodyText: string | null }> => {
    setLlm(mode === 'withLlm')
    recorder.reset()
    store.clear()

    const row = buildRow({
      id: `${c.id}:${mode}`,
      caseId: c.id,
      html: input.html,
      text: input.text,
      subject: input.subject,
    })
    store.insert(row)

    const settled = await enrichMessage(row.id)
    if (token !== runToken) {
      throw new Error(
        `${c.id} [${mode}]: this run was superseded, most likely by a timeout, and its result was discarded. Nothing was written to output.json.`,
      )
    }
    assertRunIsGenuine(mode, settled)
    return { actual: toSnapshot(store.get(row.id)!), bodyText: row.bodyText }
  }

  if (action === 'generate') {
    // withoutLlm is deterministic: one run. withLlm keeps sampling until
    // PATIENCE consecutive runs add no new answer (at most `samples`), and every
    // run must succeed or nothing is written (both collectors reject on the
    // first failure, before writeSection is reached).
    const runs =
      mode === 'withLlm'
        ? await collectUntilStable({ max: samples, patience: PATIENCE }, runOnce, (run) => answerKeys(run.actual))
        : await collectSamples(1, runOnce)
    const last = runs[runs.length - 1]
    const meta = { at: new Date().toISOString(), model: mode === 'withLlm' ? modelLabel : null }
    let section: StoredSection
    if (mode === 'withLlm') {
      const aggregate = aggregateSamples(runs.map((run) => run.actual))
      section = toSection(aggregate.snapshot, meta, { samples: aggregate.samples, observed: aggregate.observed })
    } else {
      section = toSection(last.actual, meta)
    }
    writeSection(c.outputPath, mode, section)
    record({
      caseId: c.id,
      mode,
      status: 'generated',
      failures: [],
      informational: [],
      notes: [`wrote ${relOutput}${mode === 'withLlm' ? ` (${runs.length} samples)` : ''}`, ...llmNotes(last.bodyText)],
    })
    return
  }

  const expected = stored?.[mode]
  if (!expected) throw new Error(`unreachable: "compare" planned without a stored ${mode} section`)

  // withLlm is stochastic, so a failing comparison is confirmed by repeating it
  // (compareWithRetries); withoutLlm is deterministic and gets one attempt.
  let bodyText: string | null = null
  const { comparison } = await compareWithRetries(mode === 'withLlm' ? retries : 0, async () => {
    const run = await runOnce()
    bodyText = run.bodyText
    return compareSection(mode, expected, run.actual)
  })
  const notes = llmNotes(bodyText)
  const { failures, informational, warnings } = comparison
  const failed = failures.length > 0
  record({
    caseId: c.id,
    mode,
    status: failed ? 'fail' : 'pass',
    failures,
    informational,
    warnings: warnings ?? [],
    notes,
  })

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
    // Facts about the stored baselines, read from disk after every run has had
    // its chance to write one. Informational: none of it can fail the run.
    for (const c of cases) {
      const stored = readStoredOutput(c.outputPath)
      const baseline = stored?.withLlm ?? stored?.withoutLlm
      if (!baseline) continue
      const intent = readIntent(c.intentPath)
      report.recordBaseline(c.id, {
        unstable: baseline.observed ? unstableFields(baseline.observed) : [],
        intent: intent ? intentDisagreements(intent, baseline) : [],
      })
    }
    process.stdout.write(`${report.render()}\n`)
  })

  it('has at least one case folder', () => {
    expect(cases.length, `no case folders under ${CASES_ROOT}`).toBeGreaterThan(0)
  })

  it('has a valid intent.json wherever one exists', () => {
    for (const c of cases) readIntent(c.intentPath)
  })

  for (const c of cases) {
    describe(c.id, () => {
      for (const mode of RUN_MODES) {
        // A generating withLlm run makes `samples` sequential calls.
        const timeout = mode === 'withLlm' ? CALL_TIMEOUT_MS * samples : CALL_TIMEOUT_MS
        it(mode, { timeout }, async (ctx) => {
          await runCase(c, mode, () => ctx.skip())
        })
      }
    })
  }
})
