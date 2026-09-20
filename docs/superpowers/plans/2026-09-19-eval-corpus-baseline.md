# LLM eval: realistic corpus and multi-sample baselines — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `npm run eval:email` into a solid regression baseline for `gpt-4o-mini`: harness support for text-only/multipart mail, subjects and author intent; baselines stored as several samples so they stop failing at random; and a 65-case corpus covering all 17 categories.

**Architecture:** Additive changes to the existing harness in `test/llm-eval/`. New pure modules (`case-input`, `intent`, `observed`, `compare-observed`, `samples`) each with a selftest; the runner (`email-cases.eval.ts`) is wired to them last. Fixtures are plain files under `test/llm-eval/cases/`. No production code changes.

**Tech Stack:** TypeScript, Vitest (`llm-selftest` and `llm-cases` projects in `vitest.eval.config.ts`), real `gpt-4o-mini` via `.env.eval`.

**Spec:** `docs/superpowers/specs/2026-09-19-eval-corpus-baseline-design.md`

## Global Constraints

- **No production code changes.** Only `test/llm-eval/**`, `docs/**` and the eval README change. `lib/**` is read, never edited.
- **Synthetic fixtures only:** `example.com`, "Acme", invented names; no real tokens, addresses or personal data (a secret scanner runs on commit).
- **Baseline generator is `gpt-4o-mini` at production settings** (no temperature override). `EVAL_SAMPLES` default is **5**.
- **Pass rule is per field** (categories as a set, `extractedOtp`, each link's `{isCta, ctaConfidence}`); timestamps stay informational; `withoutLlm` stays single-sample and strict.
- **Backward compatible:** a stored section with no `observed` compares exactly as today.
- **Intent is report-only:** it must never change a run's status or the exit code.
- Selftests live beside the code as `*.selftest.ts` and run with `npm run eval:email:selftest`. Full `npm run test` must pass before the merge.
- `docs/superpowers/` is gitignored but tracked; new files there need `git add -f`.
- Commit trailer on every commit:
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01VmPpgXtUGeJzQfwrqRbigr`

## File Structure

All paths under `test/llm-eval/`.

| File | Change | Responsibility |
|---|---|---|
| `lib/types.ts` | modify | `CaseDir` path fields; `Counted`, `LinkState`, `Observed`; `StoredSection` gains `samples`/`observed`; `Comparison` and `RunRecord` gain `warnings` |
| `lib/discover.ts` | modify | A case is a folder with `email.html` and/or `email.txt`; also locates `subject.txt`, `intent.json` |
| `lib/case-input.ts` | create | Read a case's html, text and subject |
| `lib/build-row.ts` | modify | `buildRow` accepts `text` and `subject` |
| `lib/intent.ts` | create | Parse/validate `intent.json`; compare intent to a baseline |
| `lib/observed.ts` | create | Aggregate N snapshots into a mode snapshot plus observed answers; list unstable fields |
| `lib/compare-observed.ts` | create | Per-field comparison against observed answers; `compareSection` dispatcher |
| `lib/samples.ts` | create | Parse `EVAL_SAMPLES`; run N sequential samples, all-or-nothing |
| `lib/stored-output.ts` | modify | `toSection` accepts `samples`/`observed` |
| `lib/report.ts` | modify | Warnings, "Unstable baselines", "Baseline vs intent" |
| `email-cases.eval.ts` | modify | Wire everything into the runner |
| `README.md` | modify | Document the new format and semantics |
| `cases/**` | create/modify | 58 new cases; `intent.json` for all 65; regenerated `output.json` |

---

### Task 1: Case inputs — discovery, `case-input`, `buildRow`

**Files:**
- Modify: `test/llm-eval/lib/types.ts` (`CaseDir`)
- Modify: `test/llm-eval/lib/discover.ts`
- Create: `test/llm-eval/lib/case-input.ts`
- Modify: `test/llm-eval/lib/build-row.ts`
- Test: `test/llm-eval/lib/discover.selftest.ts`, `test/llm-eval/lib/case-input.selftest.ts` (create), `test/llm-eval/lib/build-row.selftest.ts`

**Interfaces:**
- Produces: `CaseDir { id; dir; htmlPath: string|null; textPath: string|null; subjectPath: string|null; intentPath: string|null; outputPath: string }`; `readCaseInput(c: CaseDir): { html: string; text: string; subject: string | null }`; `readSubjectFile(file: string | null): string | null`; `buildRow({ id, caseId, html, text?, subject? })`.

- [ ] **Step 1: Write the failing tests**

Append to `discover.selftest.ts` inside `describe('discoverCases', …)`:

```ts
  it('treats a folder with only an email.txt as a case (text-only mail)', () => {
    touch('plain/email.txt', 'hello')

    const [found] = discoverCases(root)

    expect(found.id).toBe('plain')
    expect(found.htmlPath).toBeNull()
    expect(found.textPath).toBe(path.join(root, 'plain', 'email.txt'))
  })

  it('finds both parts of a multipart case', () => {
    touch('multi/email.html', '<p>hi</p>')
    touch('multi/email.txt', 'hi')

    const [found] = discoverCases(root)

    expect(found.htmlPath).toBe(path.join(root, 'multi', 'email.html'))
    expect(found.textPath).toBe(path.join(root, 'multi', 'email.txt'))
  })

  it('locates the optional subject.txt and intent.json, and nulls them when absent', () => {
    touch('with/email.html')
    touch('with/subject.txt', 'Re: hi')
    touch('with/intent.json', '{}')
    touch('without/email.html')

    // discoverCases sorts by id, and 'with' sorts before 'without'.
    const [withBoth, without] = discoverCases(root)

    expect(withBoth.subjectPath).toBe(path.join(root, 'with', 'subject.txt'))
    expect(withBoth.intentPath).toBe(path.join(root, 'with', 'intent.json'))
    expect(without.subjectPath).toBeNull()
    expect(without.intentPath).toBeNull()
  })
```

Create `case-input.selftest.ts`:

```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readCaseInput, readSubjectFile } from './case-input'
import type { CaseDir } from './types'

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-eval-input-'))
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const write = (name: string, content: string): string => {
  const file = path.join(dir, name)
  fs.writeFileSync(file, content)
  return file
}

const caseOf = (over: Partial<CaseDir>): CaseDir => ({
  id: 'c',
  dir,
  htmlPath: null,
  textPath: null,
  subjectPath: null,
  intentPath: null,
  outputPath: path.join(dir, 'output.json'),
  ...over,
})

describe('readSubjectFile', () => {
  it('returns null when there is no file', () => {
    expect(readSubjectFile(null)).toBeNull()
  })

  it('returns the first non-empty line, trimmed', () => {
    expect(readSubjectFile(write('subject.txt', '\n  Re: Saturday hike?  \nignored\n'))).toBe('Re: Saturday hike?')
  })

  it('returns null for a blank file so the caller falls back', () => {
    expect(readSubjectFile(write('blank.txt', '  \n\n'))).toBeNull()
  })

  it('keeps emoji and non-Latin text intact', () => {
    expect(readSubjectFile(write('s.txt', '📦 تم شحن طلبك\n'))).toBe('📦 تم شحن طلبك')
  })
})

describe('readCaseInput', () => {
  it('reads whichever parts exist and gives an empty string for the rest', () => {
    const htmlPath = write('email.html', '<p>hi</p>')

    expect(readCaseInput(caseOf({ htmlPath }))).toEqual({ html: '<p>hi</p>', text: '', subject: null })
  })

  it('reads a text-only case', () => {
    const textPath = write('email.txt', 'plain body')

    expect(readCaseInput(caseOf({ textPath }))).toEqual({ html: '', text: 'plain body', subject: null })
  })

  it('reads both parts and the subject of a multipart case', () => {
    const htmlPath = write('email.html', '<p>rich</p>')
    const textPath = write('email.txt', 'stub')
    const subjectPath = write('subject.txt', 'Hello')

    expect(readCaseInput(caseOf({ htmlPath, textPath, subjectPath }))).toEqual({
      html: '<p>rich</p>',
      text: 'stub',
      subject: 'Hello',
    })
  })
})
```

Append to `build-row.selftest.ts` inside `describe('buildRow', …)`:

```ts
  it('uses an explicit subject over the <title>', () => {
    const row = buildRow({ id: 'x', caseId: 'otp', html: OTP_HTML, subject: 'Fwd: Re: code' })

    expect(row.subject).toBe('Fwd: Re: code')
  })

  it('falls back to the <title> when the subject is null', () => {
    const row = buildRow({ id: 'x', caseId: 'otp', html: OTP_HTML, subject: null })

    expect(row.subject).toBe('Your Acme verification code')
  })

  it('builds a text-only row: the text part is the body and bare URLs become links', () => {
    const row = buildRow({
      id: 'x',
      caseId: 'notifications/export',
      html: '',
      text: 'Your export is ready. Download: https://app.example.com/exports/9f3a',
    })

    expect(row.text).toContain('Your export is ready')
    expect(row.html).toBe('')
    expect(row.bodyText).toContain('Your export is ready')
    expect(row.metadata.links.map((l) => l.url)).toEqual(['https://app.example.com/exports/9f3a'])
    expect(row.subject).toBe('export')
  })

  it('prefers the text part as the body when both parts exist (as live ingestion does)', () => {
    const row = buildRow({ id: 'x', caseId: 'm', html: '<p>rich body</p>', text: 'stub text' })

    expect(row.bodyText).toBe('stub text')
    expect(row.html).toBe('<p>rich body</p>')
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run eval:email:selftest`
Expected: FAIL. `case-input` does not exist, `textPath`/`subjectPath` are undefined, `buildRow` ignores `text`/`subject`.

- [ ] **Step 3: Implement**

`lib/types.ts` — replace the `CaseDir` interface:

```ts
export interface CaseDir {
  /** Path relative to the cases root, with `/` separators. */
  id: string
  dir: string
  /** At least one of `htmlPath` and `textPath` is non-null: that is what makes a folder a case. */
  htmlPath: string | null
  textPath: string | null
  subjectPath: string | null
  intentPath: string | null
  outputPath: string
}
```

`lib/discover.ts` — replace the file:

```ts
import fs from 'node:fs'
import path from 'node:path'
import type { CaseDir } from './types'

export const EMAIL_HTML_FILE = 'email.html'
export const EMAIL_TEXT_FILE = 'email.txt'
export const SUBJECT_FILE = 'subject.txt'
export const INTENT_FILE = 'intent.json'
export const OUTPUT_FILE = 'output.json'

const existing = (dir: string, name: string): string | null => {
  const file = path.join(dir, name)
  return fs.existsSync(file) ? file : null
}

/**
 * A case is any folder that directly contains an `email.html` and/or an
 * `email.txt` (both = a multipart message). Folders may be nested to group
 * cases (`security/otp-1`), and the id is the path relative to `root`. A case
 * folder is a leaf: nothing beneath it is searched.
 */
export function discoverCases(root: string): CaseDir[] {
  if (!fs.existsSync(root)) throw new Error(`Cases directory does not exist: ${root}`)

  const found: CaseDir[] = []

  const walk = (dir: string): void => {
    const htmlPath = existing(dir, EMAIL_HTML_FILE)
    const textPath = existing(dir, EMAIL_TEXT_FILE)
    if (dir !== root && (htmlPath || textPath)) {
      found.push({
        id: path.relative(root, dir).split(path.sep).join('/'),
        dir,
        htmlPath,
        textPath,
        subjectPath: existing(dir, SUBJECT_FILE),
        intentPath: existing(dir, INTENT_FILE),
        outputPath: path.join(dir, OUTPUT_FILE),
      })
      return
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name))
    }
  }

  walk(root)
  return found.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}
```

Create `lib/case-input.ts`:

```ts
import fs from 'node:fs'
import type { CaseDir } from './types'

export interface CaseInput {
  html: string
  text: string
  /** From subject.txt; null means "derive it" (the HTML <title>, then the folder name). */
  subject: string | null
}

const read = (file: string | null): string => (file ? fs.readFileSync(file, 'utf8') : '')

/** The first non-empty line of subject.txt, trimmed; null when absent or blank. */
export function readSubjectFile(file: string | null): string | null {
  if (!file) return null
  const first = fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find((line) => line.trim() !== '')
  return first ? first.trim() : null
}

export function readCaseInput(c: CaseDir): CaseInput {
  return { html: read(c.htmlPath), text: read(c.textPath), subject: readSubjectFile(c.subjectPath) }
}
```

`lib/build-row.ts` — replace `buildRow`:

```ts
export function buildRow(input: {
  id: string
  caseId: string
  html: string
  text?: string
  /** Overrides the derived subject (from subject.txt). */
  subject?: string | null
}): EvalRow {
  const text = input.text ?? ''
  const { bodyText, extractedOtp, links } = deriveIngestionFields({ text, html: input.html })
  return {
    id: input.id,
    organizationId: EVAL_ORGANIZATION_ID,
    subject: input.subject ?? deriveSubject(input.html, path.posix.basename(input.caseId)),
    text,
    html: input.html,
    bodyText,
    extractedOtp,
    categories: [],
    metadata: { links, timestamps: [] },
  }
}
```

Also update its doc comment: the row is HTML-only **unless the case has an `email.txt`**.

- [ ] **Step 4: Run to verify they pass**

Run: `npm run eval:email:selftest`
Expected: PASS (all previous 103 plus the new ones). If `runner` type errors appear for `c.htmlPath` being nullable, they are fixed in Task 7; the selftest project does not typecheck the runner.

- [ ] **Step 5: Commit**

```bash
git add test/llm-eval/lib/types.ts test/llm-eval/lib/discover.ts test/llm-eval/lib/case-input.ts test/llm-eval/lib/build-row.ts test/llm-eval/lib/discover.selftest.ts test/llm-eval/lib/case-input.selftest.ts test/llm-eval/lib/build-row.selftest.ts
git commit -m "Eval harness: support email.txt, subject.txt and intent.json case files"
```

---

### Task 2: Intent

**Files:**
- Create: `test/llm-eval/lib/intent.ts`
- Test: `test/llm-eval/lib/intent.selftest.ts`

**Interfaces:**
- Consumes: `Snapshot` (types.ts), `EMAIL_CATEGORIES` from `@/lib/llm/types`.
- Produces: `Intent { categories: EmailCategory[]; otp: string | null; note?: string }`; `parseIntent(raw: unknown, file: string): Intent`; `readIntent(file: string | null): Intent | null`; `intentDisagreements(intent: Intent, baseline: Snapshot): string[]`.

- [ ] **Step 1: Write the failing test** — `intent.selftest.ts`:

```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { intentDisagreements, parseIntent, readIntent } from './intent'
import type { Snapshot } from './types'

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  extractedOtp: null,
  categories: ['Travel'],
  metadata: { links: [], timestamps: [] },
  ...over,
})

describe('parseIntent', () => {
  it('accepts categories, otp and an optional note', () => {
    expect(parseIntent({ categories: ['Finance', 'Urgent'], otp: null, note: 'why' }, 'f')).toEqual({
      categories: ['Finance', 'Urgent'],
      otp: null,
      note: 'why',
    })
  })

  it.each([
    ['not an object', [], /must contain a JSON object/],
    ['an unknown key', { categories: ['Travel'], otp: null, categorys: [] }, /unknown key "categorys"/],
    ['empty categories', { categories: [], otp: null }, /non-empty array/],
    ['a non-category', { categories: ['Promotion'], otp: null }, /"Promotion" is not a category/],
    ['a missing otp', { categories: ['Travel'] }, /"otp" must be a string or null/],
    ['a numeric otp', { categories: ['Travel'], otp: 483920 }, /"otp" must be a string or null/],
    ['a non-string note', { categories: ['Travel'], otp: null, note: 3 }, /"note" must be a string/],
  ])('rejects %s, naming the file', (_name, raw, message) => {
    expect(() => parseIntent(raw, '/x/intent.json')).toThrow(message)
    expect(() => parseIntent(raw, '/x/intent.json')).toThrow('/x/intent.json')
  })
})

describe('readIntent', () => {
  it('returns null when there is no file', () => {
    expect(readIntent(null)).toBeNull()
  })

  it('names the file when the JSON is malformed', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'intent-')), 'intent.json')
    fs.writeFileSync(file, '{oops')

    expect(() => readIntent(file)).toThrow(/is not valid JSON/)
  })
})

describe('intentDisagreements', () => {
  it('reports nothing when the baseline matches the intent', () => {
    expect(intentDisagreements({ categories: ['Travel'], otp: null }, snap())).toEqual([])
  })

  it('compares categories as a set, ignoring order', () => {
    const baseline = snap({ categories: ['Urgent', 'Finance'] })

    expect(intentDisagreements({ categories: ['Finance', 'Urgent'], otp: null }, baseline)).toEqual([])
  })

  it('reports a category disagreement', () => {
    expect(intentDisagreements({ categories: ['Finance', 'Urgent'], otp: null }, snap({ categories: ['Finance'] }))).toEqual([
      'categories: intended ["Finance","Urgent"], baseline ["Finance"]',
    ])
  })

  it('reports an OTP stored where none was intended, and the reverse', () => {
    expect(intentDisagreements({ categories: ['Travel'], otp: null }, snap({ extractedOtp: 'HK7X2M' }))).toEqual([
      'otp: intended null, baseline "HK7X2M"',
    ])
    expect(intentDisagreements({ categories: ['Security'], otp: '482917' }, snap({ categories: ['Security'] }))).toEqual([
      'otp: intended "482917", baseline null',
    ])
  })

  it('skips categories when the baseline has none (a withoutLlm-only baseline: the LLM never ran)', () => {
    expect(intentDisagreements({ categories: ['Travel'], otp: null }, snap({ categories: [] }))).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --config vitest.eval.config.ts --project llm-selftest test/llm-eval/lib/intent.selftest.ts`
Expected: FAIL — `./intent` not found.

- [ ] **Step 3: Implement** — `lib/intent.ts`:

```ts
import fs from 'node:fs'
import { EMAIL_CATEGORIES, type EmailCategory } from '@/lib/llm/types'
import type { Snapshot } from './types'

/**
 * What the case's author says is correct, independent of any model. Report-only:
 * it is never compared in a way that can fail a run (see Report.recordBaseline).
 */
export interface Intent {
  categories: EmailCategory[]
  otp: string | null
  note?: string
}

const KEYS = new Set(['categories', 'otp', 'note'])

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Strict on purpose: a misspelt key ("categorys") must not silently vanish. */
export function parseIntent(raw: unknown, file: string): Intent {
  if (!isObject(raw)) throw new Error(`${file} must contain a JSON object`)
  for (const key of Object.keys(raw)) {
    if (!KEYS.has(key)) throw new Error(`${file}: unknown key "${key}" (expected categories, otp, note)`)
  }
  const { categories, otp, note } = raw
  if (!Array.isArray(categories) || categories.length === 0) {
    throw new Error(`${file}: "categories" must be a non-empty array`)
  }
  for (const category of categories) {
    if (!(EMAIL_CATEGORIES as readonly string[]).includes(category as string)) {
      throw new Error(`${file}: "${String(category)}" is not a category (expected one of: ${EMAIL_CATEGORIES.join(', ')})`)
    }
  }
  if (otp !== null && typeof otp !== 'string') throw new Error(`${file}: "otp" must be a string or null`)
  if (note !== undefined && typeof note !== 'string') throw new Error(`${file}: "note" must be a string`)
  return { categories: categories as EmailCategory[], otp, ...(note !== undefined ? { note } : {}) }
}

export function readIntent(file: string | null): Intent | null {
  if (!file) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${(error as Error).message}`)
  }
  return parseIntent(parsed, file)
}

const sortedSet = (values: readonly string[]): string[] => [...new Set(values)].sort()

/** Human-readable lines where the baseline differs from what the author intended. */
export function intentDisagreements(intent: Intent, baseline: Snapshot): string[] {
  const lines: string[] = []
  // An empty category list means the LLM never ran (a withoutLlm-only baseline),
  // not that it answered "nothing": there is nothing to compare.
  if (baseline.categories.length > 0) {
    const want = sortedSet(intent.categories)
    const got = sortedSet(baseline.categories)
    if (JSON.stringify(want) !== JSON.stringify(got)) {
      lines.push(`categories: intended ${JSON.stringify(want)}, baseline ${JSON.stringify(got)}`)
    }
  }
  if (intent.otp !== baseline.extractedOtp) {
    lines.push(`otp: intended ${JSON.stringify(intent.otp)}, baseline ${JSON.stringify(baseline.extractedOtp)}`)
  }
  return lines
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --config vitest.eval.config.ts --project llm-selftest test/llm-eval/lib/intent.selftest.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add test/llm-eval/lib/intent.ts test/llm-eval/lib/intent.selftest.ts
git commit -m "Eval harness: intent.json parsing and baseline-vs-intent comparison"
```

---

### Task 3: Observed answers (aggregation)

**Files:**
- Modify: `test/llm-eval/lib/types.ts`
- Create: `test/llm-eval/lib/observed.ts`
- Test: `test/llm-eval/lib/observed.selftest.ts`

**Interfaces:**
- Produces (types.ts): `Counted<T> { value: T; count: number }`; `LinkState { isCta: boolean; ctaConfidence: 'high' | 'low' }`; `Observed { categories: Counted<string[]>[]; extractedOtp: Counted<string | null>[]; links: Record<string, Counted<LinkState>[]> }`; `StoredSection = Snapshot & { _generated?: SectionMeta; samples?: number; observed?: Observed }`.
- Produces (observed.ts): `aggregateSamples(samples: Snapshot[]): { snapshot: Snapshot; samples: number; observed: Observed }`; `unstableFields(observed: Observed): string[]`.

- [ ] **Step 1: Write the failing test** — `observed.selftest.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { aggregateSamples, unstableFields } from './observed'
import type { Snapshot } from './types'

const link = (url: string, isCta: boolean, ctaConfidence: 'high' | 'low' = 'high') => ({
  url,
  label: url.split('/').pop(),
  isCta,
  ctaConfidence,
})

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  extractedOtp: null,
  categories: ['Receipts'],
  metadata: { links: [link('https://x.example/view', true)], timestamps: ['Friday'] },
  ...over,
})

describe('aggregateSamples', () => {
  it('throws on no samples', () => {
    expect(() => aggregateSamples([])).toThrow(/at least one sample/)
  })

  it('a unanimous set has one answer per field, each counted', () => {
    const { snapshot, samples, observed } = aggregateSamples([snap(), snap(), snap()])

    expect(samples).toBe(3)
    expect(observed.categories).toEqual([{ value: ['Receipts'], count: 3 }])
    expect(observed.extractedOtp).toEqual([{ value: null, count: 3 }])
    expect(observed.links['https://x.example/view']).toEqual([
      { value: { isCta: true, ctaConfidence: 'high' }, count: 3 },
    ])
    expect(snapshot).toEqual(snap())
  })

  it('stores the most frequent answer as the snapshot and lists every answer by count', () => {
    const { snapshot, observed } = aggregateSamples([
      snap({ categories: ['Security'] }),
      snap({ categories: ['Primary', 'Security'] }),
      snap({ categories: ['Security'] }),
    ])

    expect(snapshot.categories).toEqual(['Security'])
    expect(observed.categories).toEqual([
      { value: ['Security'], count: 2 },
      { value: ['Primary', 'Security'], count: 1 },
    ])
  })

  it('treats categories as sets: order and duplicates do not create a new answer', () => {
    const { observed } = aggregateSamples([
      snap({ categories: ['Urgent', 'Finance'] }),
      snap({ categories: ['Finance', 'Urgent', 'Finance'] }),
    ])

    expect(observed.categories).toEqual([{ value: ['Finance', 'Urgent'], count: 2 }])
  })

  it('breaks a tie deterministically by the smaller JSON encoding', () => {
    const forward = aggregateSamples([snap({ extractedOtp: 'B22222' }), snap({ extractedOtp: 'A11111' })])
    const backward = aggregateSamples([snap({ extractedOtp: 'A11111' }), snap({ extractedOtp: 'B22222' })])

    expect(forward.snapshot.extractedOtp).toBe('A11111')
    expect(backward.snapshot.extractedOtp).toBe('A11111')
  })

  it('takes each link its own mode, so one flip does not change the others', () => {
    const a = link('https://x.example/view', true)
    const b = link('https://x.example/track', true)
    const { snapshot, observed } = aggregateSamples([
      snap({ metadata: { links: [a, b], timestamps: [] } }),
      snap({ metadata: { links: [a, { ...b, isCta: false }], timestamps: [] } }),
      snap({ metadata: { links: [a, { ...b, isCta: false }], timestamps: [] } }),
    ])

    expect(snapshot.metadata.links.map((l) => [l.url, l.isCta])).toEqual([
      ['https://x.example/view', true],
      ['https://x.example/track', false],
    ])
    expect(observed.links['https://x.example/track']).toEqual([
      { value: { isCta: false, ctaConfidence: 'high' }, count: 2 },
      { value: { isCta: true, ctaConfidence: 'high' }, count: 1 },
    ])
  })

  it('keeps link labels and order from the first sample, and its timestamps', () => {
    const { snapshot } = aggregateSamples([
      snap({ metadata: { links: [link('https://x.example/view', true)], timestamps: ['first'] } }),
      snap({ metadata: { links: [link('https://x.example/view', true)], timestamps: ['second'] } }),
    ])

    expect(snapshot.metadata.timestamps).toEqual(['first'])
    expect(snapshot.metadata.links[0].label).toBe('view')
  })
})

describe('unstableFields', () => {
  it('is empty when every field had one answer', () => {
    expect(unstableFields(aggregateSamples([snap(), snap()]).observed)).toEqual([])
  })

  it('names each field that had more than one answer', () => {
    const flip = snap({
      categories: ['Primary', 'Receipts'],
      extractedOtp: 'A11111',
      metadata: { links: [link('https://x.example/view', false)], timestamps: [] },
    })

    expect(unstableFields(aggregateSamples([snap(), flip]).observed)).toEqual([
      'categories (2 answers)',
      'extractedOtp (2 answers)',
      'metadata.links[https://x.example/view] (2 answers)',
    ])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --config vitest.eval.config.ts --project llm-selftest test/llm-eval/lib/observed.selftest.ts`
Expected: FAIL — `./observed` not found.

- [ ] **Step 3: Implement**

`lib/types.ts` — replace the `StoredSection` line and add the types above it:

```ts
/** One distinct answer and how many baseline samples gave it. */
export interface Counted<T> {
  value: T
  count: number
}

/** The two link fields the model can change (enrichment sets `ctaConfidence: 'high'` on each link it judges). */
export interface LinkState {
  isCta: boolean
  ctaConfidence: 'high' | 'low'
}

/** Every answer seen while generating a withLlm baseline, by field. Links are keyed by URL. */
export interface Observed {
  categories: Counted<string[]>[]
  extractedOtp: Counted<string | null>[]
  links: Record<string, Counted<LinkState>[]>
}

export type StoredSection = Snapshot & { _generated?: SectionMeta; samples?: number; observed?: Observed }
```

Also change `Comparison` and `RunRecord` (used in Tasks 4 and 6):

```ts
export interface Comparison {
  failures: Diff[]
  informational: Diff[]
  /** Passing but noteworthy, e.g. an answer the baseline saw only rarely. Never fails a run. */
  warnings?: string[]
}
```

```ts
export interface RunRecord {
  caseId: string
  mode: RunMode
  status: Status
  failures: Diff[]
  informational: Diff[]
  warnings?: string[]
  notes: string[]
}
```

Create `lib/observed.ts`:

```ts
import type { Counted, LinkState, Observed, Snapshot } from './types'

const sortedSet = (values: readonly string[]): string[] => [...new Set(values)].sort()

/**
 * Tally values by their JSON encoding: highest count first, ties broken by the
 * smaller encoding. The first entry is therefore a deterministic mode, so
 * regenerating a baseline from the same samples yields the same file.
 */
function tally<T>(values: T[]): Counted<T>[] {
  const byKey = new Map<string, Counted<T>>()
  for (const value of values) {
    const key = JSON.stringify(value)
    const entry = byKey.get(key)
    if (entry) entry.count += 1
    else byKey.set(key, { value, count: 1 })
  }
  return [...byKey.entries()]
    .sort(([ka, a], [kb, b]) => b.count - a.count || (ka < kb ? -1 : ka > kb ? 1 : 0))
    .map(([, entry]) => entry)
}

/**
 * Collapse N snapshots of one case into what is stored: the mode of each field
 * as an ordinary snapshot (readable, and what a legacy reader would see) plus
 * every observed answer. The mode is per field — each link's own mode — never a
 * whole-sample vote, which would need identical answers across every field.
 */
export function aggregateSamples(samples: Snapshot[]): { snapshot: Snapshot; samples: number; observed: Observed } {
  if (samples.length === 0) throw new Error('aggregateSamples needs at least one sample')

  const categories = tally(samples.map((sample) => sortedSet(sample.categories)))
  const extractedOtp = tally(samples.map((sample) => sample.extractedOtp))

  const states = new Map<string, LinkState[]>()
  for (const sample of samples) {
    for (const link of sample.metadata.links) {
      const list = states.get(link.url) ?? []
      list.push({ isCta: link.isCta, ctaConfidence: link.ctaConfidence })
      states.set(link.url, list)
    }
  }
  const links: Record<string, Counted<LinkState>[]> = {}
  for (const [url, list] of states) links[url] = tally(list)

  const first = samples[0]
  const snapshot: Snapshot = {
    extractedOtp: extractedOtp[0].value,
    categories: categories[0].value,
    metadata: {
      links: first.metadata.links.map((link) => ({ ...link, ...links[link.url][0].value })),
      timestamps: [...first.metadata.timestamps],
    },
  }
  return { snapshot, samples: samples.length, observed: { categories, extractedOtp, links } }
}

/** The fields the model did not answer consistently while the baseline was generated. */
export function unstableFields(observed: Observed): string[] {
  const fields: string[] = []
  if (observed.categories.length > 1) fields.push(`categories (${observed.categories.length} answers)`)
  if (observed.extractedOtp.length > 1) fields.push(`extractedOtp (${observed.extractedOtp.length} answers)`)
  for (const [url, answers] of Object.entries(observed.links)) {
    if (answers.length > 1) fields.push(`metadata.links[${url}] (${answers.length} answers)`)
  }
  return fields
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run eval:email:selftest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add test/llm-eval/lib/types.ts test/llm-eval/lib/observed.ts test/llm-eval/lib/observed.selftest.ts
git commit -m "Eval harness: aggregate baseline samples into observed answers"
```

---

### Task 4: Comparison against observed answers

**Files:**
- Create: `test/llm-eval/lib/compare-observed.ts`
- Test: `test/llm-eval/lib/compare-observed.selftest.ts`

**Interfaces:**
- Consumes: `aggregateSamples`/`Observed` (Task 3), `compareSnapshots`/`diffValues` (compare.ts).
- Produces: `compareWithObserved(stored: StoredSection & { observed: Observed }, actual: Snapshot): Comparison` (always returns `warnings`); `compareSection(mode: RunMode, stored: StoredSection, actual: Snapshot): Comparison` — the only function the runner calls.

- [ ] **Step 1: Write the failing test** — `compare-observed.selftest.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { compareSection, compareWithObserved } from './compare-observed'
import { aggregateSamples } from './observed'
import type { Snapshot, StoredSection } from './types'

const VIEW = 'https://x.example/view'
const TRACK = 'https://x.example/track'

const link = (url: string, isCta: boolean, ctaConfidence: 'high' | 'low' = 'high') => ({
  url,
  label: url.split('/').pop(),
  isCta,
  ctaConfidence,
})

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  extractedOtp: null,
  categories: ['Receipts'],
  metadata: { links: [link(VIEW, true), link(TRACK, true)], timestamps: [] },
  ...over,
})

const withTrack = (isCta: boolean) => snap({ metadata: { links: [link(VIEW, true), link(TRACK, isCta)], timestamps: [] } })

/** A baseline of 4 samples: track was judged a CTA 3 times, and once not. */
const baseline = (): StoredSection & { observed: NonNullable<StoredSection['observed']> } => {
  const { snapshot, samples, observed } = aggregateSamples([withTrack(true), withTrack(true), withTrack(true), withTrack(false)])
  return { ...snapshot, samples, observed }
}

describe('compareWithObserved', () => {
  it('passes an answer that matches the mode, with no warnings', () => {
    expect(compareWithObserved(baseline(), withTrack(true))).toEqual({ failures: [], informational: [], warnings: [] })
  })

  it('passes a minority answer the baseline saw, and warns that it was rare', () => {
    const result = compareWithObserved(baseline(), withTrack(false))

    expect(result.failures).toEqual([])
    expect(result.warnings).toEqual([
      `metadata.links[${TRACK}]: {"isCta":false,"ctaConfidence":"high"} was seen in 1/4 baseline samples`,
    ])
  })

  it('does not warn when the answer was seen in exactly half the samples', () => {
    const { snapshot, samples, observed } = aggregateSamples([withTrack(true), withTrack(false)])

    expect(compareWithObserved({ ...snapshot, samples, observed }, withTrack(false)).warnings).toEqual([])
  })

  it('fails on categories the baseline never saw, listing what it did see', () => {
    const { failures } = compareWithObserved(baseline(), snap({ categories: ['Primary'] }))

    expect(failures).toEqual([{ path: 'categories', expected: [['Receipts']], actual: ['Primary'] }])
  })

  it('compares categories as a set', () => {
    const stored = aggregateSamples([snap({ categories: ['Finance', 'Urgent'] })])
    const section = { ...stored.snapshot, samples: stored.samples, observed: stored.observed }

    expect(compareWithObserved(section, snap({ categories: ['Urgent', 'Finance'] })).failures).toEqual([])
  })

  it('fails on an OTP the baseline never saw', () => {
    expect(compareWithObserved(baseline(), snap({ extractedOtp: 'HK7X2M' })).failures).toEqual([
      { path: 'extractedOtp', expected: [null], actual: 'HK7X2M' },
    ])
  })

  it('fails on a link state the baseline never saw', () => {
    const state = { isCta: false, ctaConfidence: 'low' as const }
    const actual = snap({ metadata: { links: [link(VIEW, true), link(TRACK, false, 'low')], timestamps: [] } })

    expect(compareWithObserved(baseline(), actual).failures).toEqual([
      {
        path: `metadata.links[${TRACK}]`,
        expected: [
          { isCta: true, ctaConfidence: 'high' },
          { isCta: false, ctaConfidence: 'high' },
        ],
        actual: state,
      },
    ])
  })

  it('fails when a link appeared, disappeared or changed its label', () => {
    const extra = snap({ metadata: { links: [link(VIEW, true), link(TRACK, true), link('https://x.example/new', true)], timestamps: [] } })
    const missing = snap({ metadata: { links: [link(VIEW, true)], timestamps: [] } })
    const relabelled = snap({ metadata: { links: [link(VIEW, true), { ...link(TRACK, true), label: 'Track it' }], timestamps: [] } })

    expect(compareWithObserved(baseline(), extra).failures.map((f) => f.path)).toEqual(['metadata.links[https://x.example/new]'])
    expect(compareWithObserved(baseline(), missing).failures.map((f) => f.path)).toEqual([`metadata.links[${TRACK}]`])
    expect(compareWithObserved(baseline(), relabelled).failures.map((f) => f.path)).toEqual([`metadata.links[${TRACK}].label`])
  })

  it('reports timestamps informationally and never fails on them', () => {
    const actual = snap({ metadata: { links: [link(VIEW, true), link(TRACK, true)], timestamps: ['Friday'] } })
    const result = compareWithObserved(baseline(), actual)

    expect(result.failures).toEqual([])
    expect(result.informational).toEqual([{ path: 'metadata.timestamps[0]', expected: undefined, actual: 'Friday' }])
  })
})

describe('compareSection', () => {
  it('uses the observed comparison for a withLlm section that has observed answers', () => {
    expect(compareSection('withLlm', baseline(), withTrack(false)).failures).toEqual([])
  })

  it('falls back to the strict legacy comparison for a withLlm section with no observed answers', () => {
    const legacy: StoredSection = snap()

    expect(compareSection('withLlm', legacy, withTrack(false)).failures).toEqual([
      { path: `metadata.links[1].isCta`, expected: true, actual: false },
    ])
  })

  it('is always strict for withoutLlm, even if a section somehow carries observed answers', () => {
    expect(compareSection('withoutLlm', baseline(), withTrack(false)).failures.length).toBeGreaterThan(0)
  })
})
```

Note: the `withoutLlm` test relies on `diffValues` treating the extra `samples`/`observed` keys as differences; if it does not fail there, change `compareSection` to pass only the snapshot fields (see Step 3).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --config vitest.eval.config.ts --project llm-selftest test/llm-eval/lib/compare-observed.selftest.ts`
Expected: FAIL — `./compare-observed` not found.

- [ ] **Step 3: Implement** — `lib/compare-observed.ts`:

```ts
import { compareSnapshots, diffValues } from './compare'
import type { Comparison, Counted, Diff, Observed, RunMode, Snapshot, StoredSection } from './types'

/** An accepted answer seen in fewer than this share of baseline samples is flagged. */
const RARE_BELOW = 0.5

const sortedSet = (values: readonly string[]): string[] => [...new Set(values)].sort()

/**
 * The withLlm comparison for a baseline that recorded several samples.
 *
 * A field passes when its value is one the baseline saw, per field rather than
 * per whole snapshot: with a handful of samples the joint combinations are
 * sparse, and a whole-snapshot rule would bring back the run-to-run flakiness
 * this exists to remove. Anything the baseline never saw fails.
 *
 * This detects new behaviour, not a shift in probability: an answer moving from
 * 80% to 30% of runs still passes, and only the rarity warning notices.
 */
export function compareWithObserved(
  stored: StoredSection & { observed: Observed },
  actual: Snapshot,
): Comparison {
  const failures: Diff[] = []
  const warnings: string[] = []

  const check = <T>(path: string, answers: Counted<T>[], value: T): void => {
    const key = JSON.stringify(value)
    const match = answers.find((answer) => JSON.stringify(answer.value) === key)
    if (!match) {
      failures.push({ path, expected: answers.map((answer) => answer.value), actual: value })
      return
    }
    const total = answers.reduce((sum, answer) => sum + answer.count, 0)
    if (match.count / total < RARE_BELOW) {
      warnings.push(`${path}: ${key} was seen in ${match.count}/${total} baseline samples`)
    }
  }

  check('categories', stored.observed.categories, sortedSet(actual.categories))
  check('extractedOtp', stored.observed.extractedOtp, actual.extractedOtp)

  const storedLinks = new Map(stored.metadata.links.map((link) => [link.url, link]))
  const actualUrls = new Set(actual.metadata.links.map((link) => link.url))

  for (const link of actual.metadata.links) {
    const path = `metadata.links[${link.url}]`
    const answers = stored.observed.links[link.url]
    const base = storedLinks.get(link.url)
    if (!answers || !base) {
      failures.push({ path, expected: undefined, actual: link })
      continue
    }
    // Labels come from the email, not the model: any change is an extractor change.
    if (base.label !== link.label) failures.push({ path: `${path}.label`, expected: base.label, actual: link.label })
    check(path, answers, { isCta: link.isCta, ctaConfidence: link.ctaConfidence })
  }
  for (const [url, base] of storedLinks) {
    if (!actualUrls.has(url)) failures.push({ path: `metadata.links[${url}]`, expected: base, actual: undefined })
  }

  return {
    failures,
    informational: diffValues(stored.metadata?.timestamps, actual.metadata?.timestamps, 'metadata.timestamps'),
    warnings,
  }
}

/** The one entry point the runner uses: observed answers when the baseline has them, the strict comparison otherwise. */
export function compareSection(mode: RunMode, stored: StoredSection, actual: Snapshot): Comparison {
  if (mode === 'withLlm' && stored.observed) {
    return compareWithObserved({ ...stored, observed: stored.observed }, actual)
  }
  return compareSnapshots(mode, stored, actual)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run eval:email:selftest`
Expected: PASS. If the `withoutLlm` test fails because `diffValues` finds no difference, change the last line of `compareSection` to `compareSnapshots(mode, { extractedOtp: stored.extractedOtp, categories: stored.categories, metadata: stored.metadata }, actual)` and re-run.

- [ ] **Step 5: Commit**

```bash
git add test/llm-eval/lib/compare-observed.ts test/llm-eval/lib/compare-observed.selftest.ts
git commit -m "Eval harness: per-field comparison against observed baseline answers"
```

---

### Task 5: Samples and stored-section extras

**Files:**
- Create: `test/llm-eval/lib/samples.ts`
- Modify: `test/llm-eval/lib/stored-output.ts` (`toSection`)
- Test: `test/llm-eval/lib/samples.selftest.ts`, `test/llm-eval/lib/stored-output.selftest.ts`

**Interfaces:**
- Produces: `DEFAULT_SAMPLES = 5`; `parseSamples(raw: string | undefined): number`; `collectSamples<T>(n: number, once: (index: number) => Promise<T>): Promise<T[]>`; `toSection(snapshot, meta, extras?: { samples: number; observed: Observed })`.

- [ ] **Step 1: Write the failing tests**

`samples.selftest.ts`:

```ts
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
```

Append to `stored-output.selftest.ts` (add `toSection` to its import from `./stored-output` if absent):

```ts
describe('toSection with samples', () => {
  const snapshot = { extractedOtp: null, categories: ['Travel'], metadata: { links: [], timestamps: [] } }
  const meta = { at: '2026-09-19T00:00:00.000Z', model: 'openai:gpt-4o-mini' }

  it('adds samples and observed before _generated', () => {
    const observed = { categories: [{ value: ['Travel'], count: 5 }], extractedOtp: [{ value: null, count: 5 }], links: {} }
    const section = toSection(snapshot, meta, { samples: 5, observed })

    expect(Object.keys(section)).toEqual(['extractedOtp', 'categories', 'metadata', 'samples', 'observed', '_generated'])
    expect(section.samples).toBe(5)
  })

  it('is unchanged when there are no extras', () => {
    expect(Object.keys(toSection(snapshot, meta))).toEqual(['extractedOtp', 'categories', 'metadata', '_generated'])
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run eval:email:selftest`
Expected: FAIL — `./samples` not found; `toSection` ignores extras.

- [ ] **Step 3: Implement**

`lib/samples.ts`:

```ts
export const DEFAULT_SAMPLES = 5

/**
 * `EVAL_SAMPLES`: how many provider runs make up a withLlm baseline. Parsed
 * from a string handed in, so no `process.env` read lives in a library module.
 * Bounded so a typo cannot turn one command into hundreds of API calls.
 */
export function parseSamples(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_SAMPLES
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 50) {
    throw new Error(`EVAL_SAMPLES must be a whole number from 1 to 50, got ${JSON.stringify(raw)}`)
  }
  return n
}

/**
 * Run `once` n times, one after another (the recorder and row store are shared
 * singletons, so runs cannot overlap), and return every result. All-or-nothing:
 * the first rejection propagates, so a caller can never build a baseline from a
 * partial set.
 */
export async function collectSamples<T>(n: number, once: (index: number) => Promise<T>): Promise<T[]> {
  const results: T[] = []
  for (let i = 0; i < n; i += 1) results.push(await once(i))
  return results
}
```

`lib/stored-output.ts` — replace `toSection`, and add `Observed` to the type import:

```ts
export function toSection(
  snapshot: Snapshot,
  meta: SectionMeta,
  extras?: { samples: number; observed: Observed },
): StoredSection {
  return { ...snapshot, ...extras, _generated: meta }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm run eval:email:selftest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add test/llm-eval/lib/samples.ts test/llm-eval/lib/samples.selftest.ts test/llm-eval/lib/stored-output.ts test/llm-eval/lib/stored-output.selftest.ts
git commit -m "Eval harness: EVAL_SAMPLES parsing, all-or-nothing sampling, observed in stored sections"
```

---

### Task 6: Report — warnings, unstable baselines, intent

**Files:**
- Modify: `test/llm-eval/lib/report.ts`
- Test: `test/llm-eval/lib/report.selftest.ts`

**Interfaces:**
- Consumes: `RunRecord.warnings` (Task 3 types).
- Produces: `Report.recordBaseline(caseId: string, notes: { unstable: string[]; intent: string[] }): void`; `render()` prints `(warning)` lines, "Unstable baselines" and "Baseline vs intent" sections only when there is something to show.

- [ ] **Step 1: Write the failing tests** — append to `report.selftest.ts` inside `describe('Report.render', …)`:

```ts
  it('shows the warnings of a passing run under Details', () => {
    const report = new Report()
    report.record(
      rec({
        caseId: 'receipts/order',
        mode: 'withLlm',
        status: 'pass',
        warnings: ['metadata.links[https://x/track]: {"isCta":false} was seen in 1/5 baseline samples'],
        notes: ['should not appear'],
      }),
    )

    const text = report.render()

    expect(text).toContain('PASS  receipts/order [withLlm]')
    expect(text).toContain('(warning) metadata.links[https://x/track]: {"isCta":false} was seen in 1/5 baseline samples')
    expect(text).not.toContain('should not appear')
  })

  it('lists unstable baselines', () => {
    const report = new Report()
    report.record(rec({}))
    report.recordBaseline('receipts/order', { unstable: ['categories (2 answers)'], intent: [] })

    const text = report.render()

    expect(text).toContain('Unstable baselines')
    expect(text).toContain('receipts/order: categories (2 answers)')
  })

  it('lists where the baseline disagrees with intent, and says it never fails a run', () => {
    const report = new Report()
    report.record(rec({}))
    report.recordBaseline('otp/booking-confirmation-code', { unstable: [], intent: ['otp: intended null, baseline "HK7X2M"'] })

    const text = report.render()

    expect(text).toContain('Baseline vs intent')
    expect(text).toContain('never fails a run')
    expect(text).toContain('otp/booking-confirmation-code')
    expect(text).toContain('otp: intended null, baseline "HK7X2M"')
    expect(report.hasFailures()).toBe(false)
  })

  it('prints neither section when nothing is unstable or in disagreement', () => {
    const report = new Report()
    report.record(rec({}))
    report.recordBaseline('a', { unstable: [], intent: [] })

    const text = report.render()

    expect(text).not.toContain('Unstable baselines')
    expect(text).not.toContain('Baseline vs intent')
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --config vitest.eval.config.ts --project llm-selftest test/llm-eval/lib/report.selftest.ts`
Expected: FAIL — `recordBaseline` is not a function; warnings not rendered.

- [ ] **Step 3: Implement** — `lib/report.ts`:

Add a field and method to the class:

```ts
  private baselineNotes: Array<{ caseId: string; unstable: string[]; intent: string[] }> = []

  /** Facts about a case's stored baseline. Purely informational: never affects a status or the exit code. */
  recordBaseline(caseId: string, notes: { unstable: string[]; intent: string[] }): void {
    this.baselineNotes.push({ caseId, ...notes })
  }
```

In `render()`, replace the `detailed` filter and the diffs loop:

```ts
    const detailed = this.records.filter(
      (record) =>
        record.status === 'fail' ||
        record.status === 'generated' ||
        record.informational.length > 0 ||
        (record.warnings?.length ?? 0) > 0,
    )
    if (detailed.length > 0) {
      lines.push('', 'Details')
      for (const record of detailed) {
        const showNotes = record.status === 'fail' || record.status === 'generated'
        lines.push(`${record.status.toUpperCase()}  ${record.caseId} [${record.mode}]`)
        for (const diff of record.failures) lines.push(`    ${formatDiff(diff)}`)
        for (const diff of record.informational) lines.push(`    (informational) ${formatDiff(diff)}`)
        for (const warning of record.warnings ?? []) lines.push(`    (warning) ${warning}`)
        if (showNotes) for (const note of record.notes) lines.push(`    ${note}`)
      }
    }

    const unstable = this.baselineNotes.filter((entry) => entry.unstable.length > 0)
    if (unstable.length > 0) {
      lines.push('', 'Unstable baselines (the model gave more than one answer while the baseline was generated)')
      for (const entry of unstable) lines.push(`  ${entry.caseId}: ${entry.unstable.join(', ')}`)
    }

    const disagreements = this.baselineNotes.filter((entry) => entry.intent.length > 0)
    if (disagreements.length > 0) {
      lines.push('', 'Baseline vs intent (informational; never fails a run)')
      for (const entry of disagreements) {
        lines.push(`  ${entry.caseId}`)
        for (const line of entry.intent) lines.push(`    ${line}`)
      }
    }
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm run eval:email:selftest`
Expected: PASS, including every pre-existing report test.

- [ ] **Step 5: Commit**

```bash
git add test/llm-eval/lib/report.ts test/llm-eval/lib/report.selftest.ts
git commit -m "Eval harness: report warnings, unstable baselines and baseline-vs-intent"
```

---

### Task 7: Wire the runner and document it

**Files:**
- Modify: `test/llm-eval/email-cases.eval.ts`
- Modify: `test/llm-eval/README.md`
- Modify: `.env.eval.example`

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces: `EVAL_SAMPLES`-driven multi-sample generation; `compareSection`-driven comparison; end-of-run "Unstable baselines" and "Baseline vs intent" sections.

The runner has no unit tests (it needs the real provider seam); it is verified by running it. Steps follow that.

- [ ] **Step 1: Edit imports and constants** in `email-cases.eval.ts`

Replace the `fs` import and the lib imports block with:

```ts
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { enrichMessage } from '@/lib/llm/enrichment'
import { resetProviderCache } from '@/lib/llm/factory'
import { buildRow, toSnapshot } from './lib/build-row'
import { readCaseInput } from './lib/case-input'
import { formatDiff } from './lib/compare'
import { compareSection } from './lib/compare-observed'
import { discoverCases } from './lib/discover'
import { intentDisagreements, readIntent } from './lib/intent'
import { resolveLlmPreflight } from './lib/llm-preflight'
import { aggregateSamples, unstableFields } from './lib/observed'
import { Report } from './lib/report'
import { collectSamples, parseSamples } from './lib/samples'
import { recorder, store } from './lib/shared'
import { planAction, readStoredOutput, toSection, writeSection } from './lib/stored-output'
import { RUN_MODES } from './lib/types'
import type { CaseDir, RunMode, RunRecord, Snapshot } from './lib/types'
```

(Keep `vi.mock` blocks unchanged. `compareSnapshots` is no longer imported; keep `formatDiff`.) After `const update = …` add:

```ts
// A withLlm baseline is several samples, not one: gpt-4o-mini disagrees with
// its own single-sample baseline often enough to leave most runs red.
const samples = parseSamples(process.env.EVAL_SAMPLES)
// vitest.eval.config.ts allows this long for one provider call.
const CALL_TIMEOUT_MS = 120_000
```

- [ ] **Step 2: Replace `runCaseBody`'s body from `const token = ++runToken` to the end of the function** with:

```ts
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
    // withoutLlm is deterministic: one run. withLlm: `samples` runs, all of
    // which must succeed or nothing is written (collectSamples rejects on the
    // first failure, before writeSection is reached).
    const runs = await collectSamples(mode === 'withLlm' ? samples : 1, runOnce)
    const last = runs[runs.length - 1]
    const meta = { at: new Date().toISOString(), model: mode === 'withLlm' ? modelLabel : null }
    let section
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

  const { actual, bodyText } = await runOnce()
  const notes = llmNotes(bodyText)

  const expected = stored?.[mode]
  if (!expected) throw new Error(`unreachable: "compare" planned without a stored ${mode} section`)

  const { failures, informational, warnings } = compareSection(mode, expected, actual)
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
```

- [ ] **Step 3: Replace the `describe` block at the bottom** (from `const cases = discoverCases(CASES_ROOT)` to the end) with:

```ts
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
```

Also update the `llmNotes` helper is unchanged (it reads `recorder.last()`, the final sample).

- [ ] **Step 4: Verify the wiring without spending anything**

Run (LLM blank, so `withLlm` is skipped):
`LLM_PROVIDER= npm run eval:email`
Expected: exit 0; every case `withoutLlm PASS`, `withLlm SKIPPED`; no "Unstable baselines" section (legacy baselines have no `observed`). If vitest rejects the `it(name, { timeout }, fn)` form, use `it(name, fn, timeout)` instead and re-run.

Run: `npm run eval:email:selftest`
Expected: PASS.

- [ ] **Step 5: Update `README.md` and `.env.eval.example`**

In `README.md`, replace the whole "Add a case" section with:

```markdown
## Add a case

1. Create a folder anywhere under `cases/` (grouping folders are fine) holding
   `email.html`, `email.txt`, or both (a multipart message: as in live
   ingestion, a non-empty text part is used as the body).
2. Optional `subject.txt`: one line. Without it the subject is the HTML
   `<title>`, then the folder name.
3. Add `intent.json` — what is *correct*, independent of any model:
   `{ "categories": ["Security"], "otp": "483920", "note": "why" }` (`otp` is
   `null` when there is no code). It is report-only and never fails a run; the
   report lists every case whose baseline disagrees with it.
4. Run `npm run eval:email`. The first run **generates** `output.json`: the
   `withLlm` section from `EVAL_SAMPLES` runs (default 5).
5. **Review it.** It is only what the system did. Read the "Unstable baselines"
   and "Baseline vs intent" sections of the report.
```

Replace the "What is compared" section's intro paragraph and table note with:

```markdown
A `withLlm` baseline records every answer the model gave across its samples
(`observed`, with counts) alongside the most frequent one. A run passes when
each field is a value the baseline **saw** — categories as a set, the OTP, and
each link's `isCta`/`ctaConfidence` — so ordinary run-to-run variance does not
fail it. An answer the baseline saw in under half its samples passes with a
warning. This detects *new* behaviour, not a shift in probability. A section
with no `observed` (an older file) is compared exactly, as before.
```

Add to the `.env.eval.example` (after the existing lines):

```
# EVAL_SAMPLES=5   # provider runs per case when generating a withLlm baseline (1-50)
```

- [ ] **Step 6: Run everything, then commit**

Run: `npm run eval:email:selftest && npm run test`
Expected: both PASS.

```bash
git add test/llm-eval/email-cases.eval.ts test/llm-eval/README.md .env.eval.example
git commit -m "Eval harness: multi-sample baselines, observed comparison and intent report in the runner"
```

---

### Task 8: Regenerate the 7 existing baselines and add their intent

**Files:**
- Create: `test/llm-eval/cases/<id>/intent.json` for the 7 existing ids
- Modify: `test/llm-eval/cases/<id>/output.json` for the 7 existing ids

Existing ids: `adversarial/login-promo-numeric-code`, `otp-verification-code`, `promo-discount-code`, `receipts/order-confirmation`, `regex-miss-signin-token`, `security/password-reset-link`, `security/spaced-signin-code`.

- [ ] **Step 1: Write the 7 `intent.json` files**

| Case | `categories` | `otp` | `note` |
|---|---|---|---|
| `adversarial/login-promo-numeric-code` | `["Promotions"]` | `null` | `202020 is a promo code that happens to follow "log in"; it is not a login code` |
| `otp-verification-code` | `["Security"]` | `"483920"` | `the regex finds this; the model is not asked for a code` |
| `promo-discount-code` | `["Promotions"]` | `null` | `SPRING25 is a discount code` |
| `receipts/order-confirmation` | `["Receipts"]` | `null` | `order, confirmation and tracking numbers are not codes` |
| `regex-miss-signin-token` | `["Security"]` | `"A1B2C3"` | `the regex misses "sign-in token"; the LLM fallback should recover it` |
| `security/password-reset-link` | `["Security"]` | `null` | `a reset link, no code` |
| `security/spaced-signin-code` | `["Security"]` | `"482917"` | `a real one-time code printed with a space; the stored baseline currently has none (known gap)` |

- [ ] **Step 2: Regenerate with real samples**

Run: `npm run eval:email:update`
Expected: exit 0; every case `GENERATED` for both modes; ~35 `gpt-4o-mini` calls (~$0.01). If any sample fails, nothing is written for that case: fix the cause (key, network) and re-run.

- [ ] **Step 3: Review what changed**

Run: `git diff --stat` and `git diff test/llm-eval/cases/receipts/order-confirmation/output.json`
Expected: each `withLlm` section now has `samples: 5` and `observed`; `withoutLlm` sections are unchanged. Run `npm run eval:email` and read "Unstable baselines" and "Baseline vs intent". Expect `receipts/order-confirmation` unstable on `metadata.links[…/track/…]`, and an intent disagreement on `security/spaced-signin-code` (otp). Record both in the commit message.

- [ ] **Step 4: Prove the flakiness is gone**

Run `npm run eval:email` **three times**.
Expected: at most one run has any failure. (Before this change, 3 of 5 runs failed on the same 7 cases.) If a case fails repeatedly, raise its samples: `EVAL_SAMPLES=15 npm run eval:email:update` regenerates all; note which case and why.

- [ ] **Step 5: Commit**

```bash
git add test/llm-eval/cases
git commit -m "Eval corpus: multi-sample baselines and intent for the 7 existing cases"
```

---

### Task 9: Wave 1 — eight exemplar cases

**Files:** create the eight case folders below, each with the listed files, then generate baselines.

Style rules for every fixture (all waves): `<!DOCTYPE html>`, `<html>`, `<head>` with `<meta charset="utf-8" />`; realistic wording and layout, but short of a full template unless the brief says otherwise; `example.com` domains; never a real token or address. Each case ships `intent.json`.

- [ ] **Step 1: `categories/promotions/flash-sale/`** — `email.html`, `subject.txt`, `intent.json`

`subject.txt`: `⚡ 48-hour flash sale: up to 60% off`
`intent.json`: `{"categories":["Promotions"],"otp":null,"note":"marketing with an alphanumeric discount code (FLASH60) and image-only links"}`
`email.html`: preheader (hidden `<span style="display:none">`) "Ends Sunday at midnight"; a logo link `<a href="https://shop.example.com/"><img src="…" alt="Acme Home"></a>` (image-only, no text); headline "Flash sale"; "Use code <strong>FLASH60</strong> at checkout"; hero image link; three product links labelled "Shop women", "Shop men", "Shop home"; a "Shop now" button; footer links "Manage preferences", "Unsubscribe", "Privacy policy".

- [ ] **Step 2: `categories/social/linkedin-invite/`** — `email.html`, `subject.txt`, `intent.json`

`subject.txt`: `Jordan Lee wants to connect with you on LinkedIn`
`intent.json`: `{"categories":["Social"],"otp":null,"note":"the button 'View on LinkedIn' is the main action but the CTA heuristic marks it non-CTA with high confidence (known gap)"}`
`email.html`: "Jordan Lee, Staff Engineer at Acme, wants to connect." Buttons: "Accept", "View profile", "View on LinkedIn"; footer "Unsubscribe", "Help".

- [ ] **Step 3: `categories/primary/quoted-reply-chain/`** — `email.txt` (text-only), `subject.txt`, `intent.json`

`subject.txt`: `Re: Saturday hike?`
`intent.json`: `{"categories":["Primary"],"otp":null,"note":"a person replying to a person; the phone number and flight number are not codes"}`
`email.txt`: a two-line friendly reply ("Sounds good! I'll bring the trail mix. Call me on 415-555-0134 if the plan changes — I land on UA 482 at 6pm Friday."), a signature (`-- Sam`), then a quoted chain: `On Tue, Sep 9, 2026 at 4:12 PM Alex Rivera <alex@example.com> wrote:` followed by 5–6 lines each prefixed `> `, including a nested `>> ` earlier message.

- [ ] **Step 4: `categories/finance/payment-failed/`** — `email.html`, `subject.txt`, `intent.json`

`subject.txt`: `Action needed: your payment of $29.00 didn't go through`
`intent.json`: `{"categories":["Finance","Urgent"],"otp":null,"note":"money owed plus a deadline; Urgent accompanies Finance"}`
`email.html`: "We couldn't charge the Visa ending in 4821 for your Acme Pro plan ($29.00)." "Update your payment method by September 24 or your workspace will be paused." Links: "Update payment method", "View invoice", "Contact support".

- [ ] **Step 5: `categories/spam/phishing-lookalike/`** — `email.html`, `subject.txt`, `intent.json`

`subject.txt`: `Your Acme account has been suspended - verify now`
`intent.json`: `{"categories":["Spam"],"otp":null,"note":"phishing: generic greeting, urgency, link to a lookalike domain, no legitimate relationship"}`
`email.html`: "Dear Customer," "We detected unusual activity and your account has been temporarily limited." "You must verify your identity within 24 hours or it will be permanently closed." One button "Verify your account" → `http://acme-secure-verify.example.net/login`; a footer "Acme Security Team".

- [ ] **Step 6: `otp/booking-confirmation-code/`** — `email.html`, `subject.txt`, `intent.json`

`subject.txt`: `Your trip to Lisbon is confirmed`
`intent.json`: `{"categories":["Travel"],"otp":null,"note":"'confirmation code' here is a booking reference, not a one-time code; the regex stores it as an OTP (known gap)"}`
`email.html`: "Thanks for booking with Acme Air." "Your confirmation code is <strong>HK7X2M</strong>." Itinerary: "Departs Tuesday, October 14 at 08:35 from JFK, arrives 20:50 in LIS", flight "AA 205". Links: "Manage booking", "Check in online".

- [ ] **Step 7: `structure/text-only-plain/`** — `email.txt` (text-only), `subject.txt`, `intent.json`

`subject.txt`: `Your data export is ready`
`intent.json`: `{"categories":["Notifications"],"otp":null,"note":"plain-text mail with bare URLs: exercises the text link-extraction path"}`
`email.txt`: "Hi Sam,\n\nYour data export is ready. Download it here (the link expires in 24 hours):\nhttps://app.example.com/exports/9f3a1c\n\nIf you didn't request this, ignore this message or contact https://example.com/support.\n\n— The Acme team".

- [ ] **Step 8: `structure/long-marketing-template/`** — generate `email.html`, plus `subject.txt`, `intent.json`

`subject.txt`: `Your summer edit is here`
`intent.json`: `{"categories":["Promotions"],"otp":null,"note":"10 KB+ template: body text passes the 4,000-character prompt cap and there are more than 10 low-confidence links (image-only links first), so neither reaches the model"}`

Create `test/llm-eval/scripts/make-long-template.mjs` (kept so the fixture is reproducible), run it, and commit its output:

```js
// Regenerates cases/structure/long-marketing-template/email.html. Deterministic.
import fs from 'node:fs'
import path from 'node:path'

const out = path.resolve(import.meta.dirname, '../cases/structure/long-marketing-template/email.html')
const css = Array.from({ length: 60 }, (_, i) =>
  `.tile-${i} { margin: ${i % 7}px; padding: ${(i % 5) + 4}px; font: 14px/1.5 Helvetica, Arial, sans-serif; color: #${(0x222222 + i * 0x010101).toString(16)}; }`,
).join('\n    ')
const icons = ['facebook', 'instagram', 'x', 'pinterest', 'tiktok', 'youtube']
  .map((n) => `<a href="https://social.example.com/${n}"><img src="https://cdn.example.com/${n}.png" alt="" width="24" height="24"></a>`)
  .join(' ')
const items = ['Linen shirt', 'Wide-leg trousers', 'Canvas tote', 'Leather sandals', 'Straw hat', 'Cotton dress', 'Stoneware mug', 'Beeswax candle']
const tiles = Array.from({ length: 24 }, (_, i) => {
  const name = `${items[i % items.length]} No. ${i + 1}`
  return `<tr><td class="tile-${i}"><a href="https://shop.example.com/p/${i + 1}?utm_source=email&utm_campaign=summer-edit">${name}</a>
      <p>${name} is cut from a soft, breathable fabric that holds its shape wash after wash. Available in four colours and sizes XS to XXL, with free returns within thirty days of delivery.</p></td></tr>`
}).join('\n    ')

const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Your summer edit is here</title>
    <style>
    ${css}
    </style>
  </head>
  <body>
    <span style="display:none">New arrivals, restocks and the pieces everyone is talking about.</span>
    <table width="600" align="center">
    <tr><td><a href="https://shop.example.com/"><img src="https://cdn.example.com/logo.png" alt="Acme Home"></a></td></tr>
    <tr><td><a href="https://shop.example.com/summer"><img src="https://cdn.example.com/hero.jpg" alt="Summer edit"></a></td></tr>
    <tr><td><h1>The summer edit</h1><p>Twenty-four pieces chosen by our stylists for long days and warm evenings.</p>
      <p><a href="https://shop.example.com/summer">Shop now</a></p></td></tr>
    ${tiles}
    <tr><td>${icons}</td></tr>
    <tr><td><p>Use code <strong>SUMMER30</strong> for 30% off your first order. Offer ends July 31.</p>
      <p><a href="https://shop.example.com/preferences">Manage preferences</a> · <a href="https://shop.example.com/unsubscribe">Unsubscribe</a> · <a href="https://shop.example.com/privacy">Privacy policy</a></p>
      <p>Acme Home Ltd, 1 Example Street, Anytown. You are receiving this because you signed up at shop.example.com.</p></td></tr>
    </table>
  </body>
</html>
`
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, html)
console.log(`wrote ${out} (${html.length} bytes)`)
```

Run: `node test/llm-eval/scripts/make-long-template.mjs`
Expected: `wrote … (≥ 10000 bytes)`. The `scripts/` folder is not a case (no `email.html`/`email.txt` directly inside it).

- [ ] **Step 9: Verify the structural claims** with a scratch script (not committed) at `/private/tmp/claude-501/-Users-roshan-work-code-inboxui/c454dbcc-9246-4d65-b420-d9a598b35cb4/scratchpad/check-long.ts`:

```ts
import fs from 'node:fs'
import { deriveIngestionFields } from '/Users/roshan/work/code/inboxui/.claude/worktrees/eval-corpus/lib/email/derive-ingestion-fields'
const html = fs.readFileSync('/Users/roshan/work/code/inboxui/.claude/worktrees/eval-corpus/test/llm-eval/cases/structure/long-marketing-template/email.html', 'utf8')
const f = deriveIngestionFields({ text: '', html })
console.log({ htmlBytes: html.length, bodyChars: f.bodyText?.length, links: f.links.length, low: f.links.filter((l) => l.ctaConfidence === 'low').length, otp: f.extractedOtp })
```

Run: `npx tsx /private/tmp/claude-501/-Users-roshan-work-code-inboxui/c454dbcc-9246-4d65-b420-d9a598b35cb4/scratchpad/check-long.ts`
Expected: `htmlBytes ≥ 10000`, `bodyChars > 4000`, `low > 10`, `otp: null`. If not, lengthen the tile copy or add tiles until true.

- [ ] **Step 10: Generate baselines and review**

Run: `npm run eval:email` (new cases generate `output.json`; ~8 × 6 calls, ~$0.01).
Expected: 8 new `GENERATED`; the 7 old ones `PASS`. Read "Unstable baselines" and "Baseline vs intent". Expected disagreements: `otp/booking-confirmation-code` (otp: baseline `"HK7X2M"`), `social/linkedin-invite` only via CTA (not shown; note it in the commit). Fix a fixture only if it is unrealistic or accidentally ambiguous; never edit `output.json` by hand.

- [ ] **Step 11: Commit**

```bash
git add test/llm-eval/cases test/llm-eval/scripts
git commit -m "Eval corpus wave 1: eight exemplar cases across categories, otp and structure"
```

---

### Task 10: Wave 2 — the remaining 29 category cases

**Files:** `test/llm-eval/cases/categories/<category>/<variant>/{email.html,subject.txt,intent.json}` for each row. Use the wave-1 fixtures as the style reference. The brief fixes every property a test depends on (labels, code-like tokens, intended answer); wording around it is free.

Every `intent.json` is `{"categories": <col 3>, "otp": null, "note": <col 4>}` unless noted.

| Case | Subject | Intended | Must contain / note |
|---|---|---|---|
| `primary/personal-plan` | `Weekend plans` | `["Primary"]` | Short human note from "Sam"; "call me on 415-555-0134", flight "UA 482". No links. Digits that are not codes. |
| `promotions/loyalty-points-offer` | `2,400 points expire Sept 30` | `["Promotions"]` | Loyalty balance nudge, boundary with Notifications. Links "Redeem points" and "View balance". |
| `social/instagram-comment` | `aria_k commented on your photo` | `["Social"]` | Links "View comment" and "Open Instagram" (the latter is heuristically non-CTA). |
| `receipts/subscription-invoice` | `Your Acme Pro invoice #INV-20931` | `["Receipts"]` | "$12.00 paid"; invoice number is code-bait. Link "Download invoice". |
| `receipts/shipping-delivered` | `Your package was delivered` | `["Receipts"]` | Tracking number `1Z999AA10123456784`; link "View delivery photo". |
| `finance/card-alert` | `Purchase alert: $84.20 at ACME STORE` | `["Finance"]` | Card ending 4821. Links "Review activity" and "This wasn't me". |
| `travel/flight-itinerary` | `Your itinerary: LIS to JFK` | `["Travel"]` | Flight TP 205, times, seat 14C. No confirmation code. Links "View itinerary", "Check in". |
| `travel/hotel-confirmation` | `Reservation confirmed at Hotel Aurora` | `["Travel"]` | "Confirmation number: 58203917" (a number, not a code); check-in/out dates. Link "View reservation". |
| `support/ticket-reply` | `[Ticket #48211] Re: Cannot export report` | `["Support"]` | Reply from "Dana, Acme Support"; ticket number is code-bait. Link "View ticket". |
| `support/ticket-resolved-survey` | `Your ticket was resolved — how did we do?` | `["Support"]` | Three rating links labelled with emoji only: "😀", "😐", "🙁". |
| `newsletters/editorial-digest` | `The Weekly Dispatch #212` | `["Newsletters"]` | Five articles each with a "Read more" link (heuristically non-CTA). Not a sales pitch. |
| `newsletters/essay-substack-style` | `On slow software` | `["Newsletters"]` | ~2,500-character essay by one author; links "Subscribe", "Share". Boundary with Primary. |
| `communities/reddit-digest` | `Top posts from r/selfhosted this week` | `["Communities"]` | Five thread links labelled with the post titles. |
| `communities/discord-mentions` | `You were mentioned in #general` | `["Communities"]` | Server "Acme Devs"; two mention excerpts; link "Open Discord". |
| `security/new-device-alert` | `New sign-in from Chrome on Windows` | `["Security"]` | Location "Lisbon, PT", time. Links "Yes, it was me" and "Secure your account". No code. |
| `security/two-factor-enabled` | `Two-factor authentication is now on` | `["Security"]` | Mentions "backup codes" without printing any. Link "Manage security settings". |
| `scheduling/calendar-invite` | `Invitation: Design review @ Tue Oct 14, 3pm (PDT)` | `["Scheduling"]` | Links "Yes", "No", "Maybe", "Join with Google Meet". Several timestamps. |
| `scheduling/appointment-reminder` | `Reminder: dental appointment tomorrow 9:30 AM` | `["Scheduling"]` | Links "Confirm appointment" and "Reschedule". |
| `applications/application-received` | `We received your application for Senior Engineer` | `["Applications"]` | "Application ID: A-20931" (code-bait). No links. |
| `applications/interview-request` | `Interview invitation: pick a time` | `["Applications"]` | Link "Choose a time". Boundary with Scheduling. |
| `notifications/ci-build-failed` | `[acme/api] Build #4821 failed on main` | `["Notifications"]` | HTML notification; links "View build", "View diff". |
| `notifications/document-shared` | `Priya shared "Q4 roadmap" with you` | `["Notifications"]` | Link "Open". Boundary with Communities. |
| `education/course-digest` | `This week in Intro to Databases` | `["Education"]` | Lecture list, one assignment, link "Go to course". |
| `education/assignment-due` | `Assignment 3 is due Friday at 11:59 PM` | `["Education"]` | Deadline; link "Submit assignment". |
| `agents/agent-outreach` | `Scheduling a call for Jordan Lee` | `["Agents"]` | Says it is an AI assistant acting for Jordan Lee and proposes three times. Link "Pick a time". |
| `agents/agent-to-agent-handoff` | `task-handoff: reconcile-invoices` | `["Agents"]` | Body is a JSON block: `task_id`, `status: "ready"`, `callback_url`. No human prose. |
| `urgent/service-outage` | `Major outage: API errors elevated` | `["Notifications","Urgent"]` | Status-page style incident update, started time, link "View status page". |
| `urgent/account-suspension-deadline` | `Your Acme account will be suspended on October 3` | `["Finance","Urgent"]` | Legitimate vendor (`acme.example.com`), calm wording, billing-update deadline; link "Update billing". |
| `spam/prize-scam` | `Congratulations!! You've won a $1,000 gift card` | `["Spam"]` | Claim-your-prize link "Claim now" to an unrelated domain; poor grammar; no legitimate relationship. |

- [ ] **Step 1:** Write the 29 case folders (`email.html`, `subject.txt`, `intent.json` each). Prefer several `Write` calls per message.
- [ ] **Step 2:** Run `npm run eval:email`. Expected: 29 new `GENERATED`; nothing previously passing fails (all earlier cases unchanged).
- [ ] **Step 3:** Read the report. For each "Baseline vs intent" line, decide: fixture ambiguous (fix the email so the intended answer is the clear reading) or real model/extractor behaviour (leave; it is the point). Do not edit `output.json`. Regenerate only the affected case by deleting its `output.json` and re-running.
- [ ] **Step 4:** Commit: `git add test/llm-eval/cases && git commit -m "Eval corpus wave 2: remaining category cases"`

---

### Task 11: Wave 3 — the remaining OTP and structure cases

**Files:** `test/llm-eval/cases/otp/<variant>/…` (13) and `test/llm-eval/cases/structure/<variant>/…` (8). Same rules as Task 10.

| Case | Files | Subject | Intended (`categories`, `otp`) | Must contain / note |
|---|---|---|---|---|
| `otp/coupon-code-with-colon` | html | `Your exclusive offer` | `["Promotions"]`, `null` | "Your exclusive code: 482913 takes 20% off your next order." Regex stores it (known gap). |
| `otp/brand-in-the-middle` | html | `Your Acme Cloud verification code` | `["Security"]`, `"482913"` | "AC-482913 is your Acme Cloud verification code." Regex misses (known gap). |
| `otp/spaced-no-qualifier` | html | `Your Acme ID code` | `["Security"]`, `"837412"` | "Your Acme ID Code is: 837 412. Do not share it." Regex and LLM guard both miss (known gap). |
| `otp/spanish-verification` | html | `Tu código de verificación de Acme` | `["Security"]`, `"483920"` | "Tu código de verificación es 483920. Caduca en 10 minutos." |
| `otp/german-verification` | html | `Ihr Acme-Bestätigungscode` | `["Security"]`, `"483920"` | "Ihr Bestätigungscode lautet 483920. Er ist 10 Minuten gültig." |
| `otp/french-verification` | html | `Votre code de vérification Acme` | `["Security"]`, `"483920"` | "Votre code de vérification est 483920. Il expire dans 10 minutes." |
| `otp/two-codes-old-and-new` | html | `Your new Acme code` | `["Security"]`, `"771204"` | "Your previous verification code 112233 has expired. Your new verification code is 771204." (old one first) |
| `otp/magic-link-and-code` | html | `Sign in to Acme` | `["Security"]`, `"482913"` | "Click the button below, or enter the login code 482913." Button "Sign in to Acme". |
| `otp/zero-width-digits` | html | `Your Acme verification code` | `["Security"]`, `"483920"` | Code written `48&#8203;39&#8203;20` (zero-width spaces inside). |
| `otp/digit-per-table-cell` | html | `Your Acme verification code` | `["Security"]`, `"483920"` | "Your verification code:" then a one-row table with one digit per `<td>`. |
| `otp/forwarded-stale-code` | html | `Fwd: Your Acme verification code` | `["Primary"]`, `null` | "FYI, see below" then "---------- Forwarded message ---------" containing an old "Your verification code is 618204". A forwarded old code is not a fresh one (judgement; known gap). |
| `otp/phishing-with-code` | html | `Security alert: unusual sign-in` | `["Spam"]`, `null` | Generic greeting, "Your verification code is 837412", then "If this wasn't you, call +1-555-0100 immediately" and a link to a lookalike domain. |
| `otp/friend-gate-code` | txt | `Re: Saturday` | `["Primary"]`, `null` | "The gate code is 4821, see you at 7." (judgement: a static shared code, not a one-time code; known gap) |
| `structure/many-image-only-links-first` | html | `Tickets go on sale Friday` | `["Promotions"]`, `null` | Fourteen image-only links (logo, hero, twelve icons) **before** a real "Get your ticket" button, so the button falls past the 10-link cap and never reaches the model. |
| `structure/otp-beyond-4000-chars` | html | `Your Acme sign-in token` | `["Security"]`, `"K9M2X7"` | ~4,500 characters of footer-style legal text, then "Use sign-in token K9M2X7 to continue." The model only sees the first 4,000 characters (known limit). |
| `structure/multipart-differing-parts` | html+txt | `Summer sale starts now` | `["Promotions"]`, `null` | `email.txt` is the stub "Your email client does not support HTML. View this email in your browser: https://shop.example.com/view/8f2" and `email.html` holds the real sale. Live ingestion prefers the text part, so the model sees only the stub (known gap). |
| `structure/image-only-promo` | html | `Summer sale starts now` | `["Promotions"]`, `null` | Body is only `<img>` tags inside links, with alt text; no text. |
| `structure/bounce-notice` | txt | `Delivery Status Notification (Failure)` | `["Notifications"]`, `null` | "Your message to friend@example.org couldn't be delivered." with "550 5.1.1 The email account does not exist". |
| `structure/out-of-office` | txt | `Automatic reply: Project update` | `["Primary"]`, `null` | "I'm out of the office until October 20 with limited access to email." |
| `structure/subject-re-fwd` | html | `Fwd: Re: Fwd: invoice question` | `["Primary"]`, `null` | Two-line note from a colleague forwarding a thread; no code. Exercises `subject.txt`. |
| `structure/entities-rtl-emoji` | html | `📦 تم شحن طلبك #48291` | `["Receipts"]`, `null` | Arabic "تم شحن طلبك" with Latin order number 48291, `&amp;`, `&nbsp;` and an emoji in the body; `dir="rtl"`. |

Files column: `html` = `email.html`, `txt` = `email.txt`, `html+txt` = both. Every case also gets `subject.txt` and `intent.json` (`note` = the last column).

- [ ] **Step 1:** Write the 21 case folders.
- [ ] **Step 2:** For `structure/otp-beyond-4000-chars`, confirm the token sits past 4,000 characters using the scratch check from Task 9 Step 9 (adapt the path). Expected: `bodyChars > 4600`, and the index of `K9M2X7` in `bodyText` is greater than 4000.
- [ ] **Step 3:** Run `npm run eval:email`. Expected: 21 new `GENERATED`; earlier cases still `PASS`.
- [ ] **Step 4:** Read the report as in Task 10 Step 3. Most `otp/*` and a few `structure/*` cases are *supposed* to appear under "Baseline vs intent".
- [ ] **Step 5:** Commit: `git add test/llm-eval/cases && git commit -m "Eval corpus wave 3: otp variants and structure cases"`

---

### Task 12: Final verification and merge

- [ ] **Step 1: Selftests and full suite**

Run: `npm run eval:email:selftest && npm run test`
Expected: both PASS; test count not lower than the 2615 baseline.

- [ ] **Step 2: Stability acceptance** — run `npm run eval:email` three times.
Expected: no failures in at least two of the three runs. Any failing case is investigated: baseline under-sampling (regenerate that case with a higher `EVAL_SAMPLES`) or a real change.

- [ ] **Step 3: Confirm nothing outside scope changed**

Run: `git diff main --stat | tail -3` and `git diff main --name-only | grep -v '^test/llm-eval/\|^docs/\|^\.env\.eval\.example'`
Expected: the second command prints nothing (no `lib/**` or app changes).

- [ ] **Step 4: Merge into the original checkout.** Leave this worktree (`ExitWorktree` with `keep`), then in `/Users/roshan/work/code/inboxui` on `main`:

```bash
git merge --no-ff worktree-eval-corpus -m "Merge eval corpus: multi-sample baselines and 65-case corpus"
```

Do **not** push. The `worktree-ollama-reasoning-effort` branch is unrelated and stays unmerged.

- [ ] **Step 5: Verify on `main`** — run `npm run test` and `npm run eval:email:selftest` in the original checkout; both must pass.
