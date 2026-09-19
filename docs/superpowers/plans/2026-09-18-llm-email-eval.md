# LLM Email Eval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dedicated, database-free harness (`npm run eval:email`) that runs every `email.html` under a checked-in cases directory through the real ingestion extraction and the real LLM enrichment step, twice (LLM off, LLM on), compares the result with the `output.json` stored next to it, and prints pass/fail counts and diffs.

**Architecture:** A separate Vitest config with two projects (`llm-cases`, `llm-selftest`) that `npm test` never sees. The case runner mocks exactly one module, `@/lib/db`, with a two-method in-memory row store, and wraps the provider returned by the real `getProvider()` in a recorder — so the deterministic extraction, the prompt, the provider adapters, `acceptLlmOtp`, the `Security` gate and the CTA merge are all the **real** code. The deterministic extraction sequence, currently copy-pasted in two production routes, is first extracted into one shared helper so the eval cannot drift from live ingestion.

**Tech Stack:** Vitest 4 (projects), TypeScript, `dotenv`, the existing `lib/email/*` and `lib/llm/*` modules. No new dependencies.

**Spec:** none as a separate file. The design was approved in conversation; it is the "Design" section below.

## Design (approved)

- **Layout:** `test/llm-eval/cases/<any folder name>/{email.html, output.json}`; grouping sub-folders are allowed (a case is any folder that directly contains `email.html`).
- **Two runs per case:** `withoutLlm` (no provider configured) and `withLlm` (provider from `.env.eval` / exported `LLM_*`).
- **`output.json`** holds one section per run: `{ extractedOtp, categories, metadata: { links, timestamps }, _generated: { at, model } }`. It is generated on the first run, then acts as the expected value. A human reviews and corrects it.
- **Generation rules:** missing file or missing section → generate; existing section → compare, never overwrite; `EVAL_UPDATE=1` regenerates. `withLlm` with no LLM configured → SKIPPED (never generated, never failed).
- **Comparison:** `withoutLlm` is fully strict. `withLlm` is strict on `extractedOtp` and `metadata.links`, compares `categories` as an unordered set, and only *prints* `metadata.timestamps` differences.
- **Report:** per-case line, totals per run (`pass · fail · generated · skipped`), a diff block per failure, the raw LLM proposal next to the stored result, non-zero exit on any FAIL.
- **Honesty guard:** `enrichMessage` swallows provider errors. A `withLlm` run whose provider call failed, or did not happen, must FAIL and write nothing — never generate a baseline from an empty result.

## Global Constraints

- **No database, no Redis, no network** except the one configured LLM provider. Only `@/lib/db` is faked.
- **Never part of `npm test` or `npm run test:integration`.** The harness runs only through the three scripts `eval:email`, `eval:email:update`, `eval:email:selftest`. The root `vitest.config.ts` includes only specific directories, so `test/llm-eval/**` is never picked up — Task 8 verifies this.
- **Read `.env.eval` only, never `.env`** (that carries development secrets). `override: false`, so an exported variable wins.
- **Report output must use `process.stdout.write`.** `console.log` output is swallowed under this setup (verified); `process.stdout.write` in `afterAll` reaches the terminal before Vitest's own summary.
- **Never use the bare word `eval` as a shell argument** (e.g. `--project eval`): the shell safety check reads it as the `eval` builtin and refuses the command. The projects are named `llm-cases` and `llm-selftest`.
- **Test-first.** Every code task writes the failing test, watches it fail, then implements.
- **Node 26:** until PR #173 merges, prefix root-suite commands with `NODE_OPTIONS=--no-experimental-webstorage` (the `ui` project's jsdom setup breaks otherwise). The eval scripts use the `node` environment and do not need it.
- **Base branch:** work is on `worktree-llm-eval`, stacked on `worktree-otp-llm-fallback` (PR #175), because the eval measures the OTP fallback that PR introduces.
- **Commit procedure:** write the message to a scratchpad file and run `git commit -F <file>`. The message is the subject given in each task, a blank line, and these two trailer lines last:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GvkofD952qYHEZpV35jvtZ
  ```
- **Lint/type gate per task:** `npx eslint <touched paths>` prints nothing, and `npx tsc --noEmit 2>&1 | grep -E "^(<touched dirs>)"` prints nothing (the repo has pre-existing `tsc` errors elsewhere; only touched paths matter).

## File Structure

| Path | Responsibility |
|---|---|
| `lib/email/derive-ingestion-fields.ts` | **New, production.** The one place that turns `{text, html}` into `{bodyText, extractedOtp, links}`. |
| `app/api/webhooks/email/route.ts`, `app/api/app/emailInbox/[id]/send/route.ts` | **Modified.** Call the helper instead of repeating the four-step sequence. |
| `vitest.eval.config.ts` | Two projects; loads `.env.eval`; aliases `@` and `server-only`. |
| `.env.eval.example` | Documents the `LLM_*` variables. |
| `test/llm-eval/lib/types.ts` | Every shared type and the `RUN_MODES` constant. Defined once. |
| `test/llm-eval/lib/discover.ts` | Find case folders. |
| `test/llm-eval/lib/build-row.ts` | `email.html` → the row live ingestion would store; row → `Snapshot`. |
| `test/llm-eval/lib/compare.ts` | Deep diff + the per-mode comparison rules + diff formatting. |
| `test/llm-eval/lib/stored-output.ts` | Read/merge/write `output.json`; decide compare / generate / skip. |
| `test/llm-eval/lib/row-store.ts` | In-memory stand-in for the two Prisma calls `enrichMessage` makes. |
| `test/llm-eval/lib/recording-provider.ts` | Wraps the real provider to record calls, results and errors. |
| `test/llm-eval/lib/shared.ts` | The singletons (`store`, `recorder`) the mocks and the runner share. |
| `test/llm-eval/lib/report.ts` | Collects run records; renders the summary. |
| `test/llm-eval/email-cases.eval.ts` | The runner: wiring, env toggling, one Vitest test per (case, mode). |
| `test/llm-eval/lib/*.selftest.ts` | Unit tests for the helpers above. |
| `test/llm-eval/cases/*/` | Sample cases, then yours. |
| `test/llm-eval/README.md` | How to use it. |

---

### Task 1: Shared ingestion helper (production refactor)

Behavior-preserving. The eval and both routes must compute `bodyText`, `extractedOtp` and `links` the same way; today that sequence exists twice.

**Files:**
- Create: `lib/email/derive-ingestion-fields.ts`
- Create: `lib/email/__tests__/derive-ingestion-fields.test.ts`
- Modify: `app/api/webhooks/email/route.ts` (imports lines 9-12; body ~lines 238-244; create data ~line 268)
- Modify: `app/api/app/emailInbox/[id]/send/route.ts` (imports lines 8-11; lines 132-133; ~line 146)

**Interfaces:**
- Produces: `deriveIngestionFields(input: { text: string; html: string }): IngestionFields` where `IngestionFields = { bodyText: string | null; extractedOtp: string | null; links: ClassifiedLink[] }`. Consumed by Task 3.

- [ ] **Step 1: Record the route baseline**

Run: `NODE_OPTIONS=--no-experimental-webstorage npx vitest run app/api/webhooks/email "app/api/app/emailInbox"`
Expected: all pass (note the count; it must be identical after the refactor).

- [ ] **Step 2: Write the failing test**

Create `lib/email/__tests__/derive-ingestion-fields.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { deriveIngestionFields } from '../derive-ingestion-fields'

describe('deriveIngestionFields', () => {
  it('derives body text, the regex OTP and classified links from an HTML-only email', () => {
    const html =
      '<p>Your verification code is <strong>483920</strong></p>' +
      '<a href="https://example.com/verify">Verify email</a>'

    const fields = deriveIngestionFields({ text: '', html })

    expect(fields.bodyText).toContain('483920')
    expect(fields.extractedOtp).toBe('483920')
    expect(fields.links).toEqual([
      { url: 'https://example.com/verify', label: 'Verify email', isCta: true, ctaConfidence: 'high' },
    ])
  })

  it('prefers the provided text part over the HTML for both the body text and the OTP', () => {
    const fields = deriveIngestionFields({
      text: 'Your security code is 111222',
      html: '<p>Your security code is 999888</p>',
    })

    expect(fields.bodyText).toBe('Your security code is 111222')
    expect(fields.extractedOtp).toBe('111222')
  })

  it('returns nulls and no links for an empty email', () => {
    expect(deriveIngestionFields({ text: '', html: '' })).toEqual({
      bodyText: null,
      extractedOtp: null,
      links: [],
    })
  })

  it('does not treat a discount code as an OTP, and leaves a marketing link low-confidence', () => {
    const fields = deriveIngestionFields({
      text: '',
      html:
        '<p>Use discount code SPRING25 for 25% off at checkout.</p>' +
        '<a href="https://shop.example.com/sale">Shop the sale</a>',
    })

    expect(fields.extractedOtp).toBeNull()
    expect(fields.links).toEqual([
      { url: 'https://shop.example.com/sale', label: 'Shop the sale', isCta: false, ctaConfidence: 'low' },
    ])
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run --project node lib/email/__tests__/derive-ingestion-fields.test.ts`
Expected: FAIL — cannot resolve `../derive-ingestion-fields`.

- [ ] **Step 4: Implement the helper**

Create `lib/email/derive-ingestion-fields.ts`:

```ts
import { deriveBodyText } from '@/lib/email/extract-body-text'
import { extractLinks } from '@/lib/email/extract-links'
import { extractOtp } from '@/lib/email/extract-otp'
import { classifyLinks, type ClassifiedLink } from '@/lib/email/cta-heuristic'

export interface IngestionFields {
  bodyText: string | null
  extractedOtp: string | null
  links: ClassifiedLink[]
}

/**
 * The deterministic part of ingestion, in one place: the searchable body text,
 * the regex-extracted OTP and the classified links. Every path that creates an
 * EmailMessage (the webhook ingest, the send route) and the LLM eval harness
 * (test/llm-eval) call this rather than repeating the sequence, so they cannot
 * drift apart. None of it is gated behind the LLM plan or quota.
 */
export function deriveIngestionFields(input: { text: string; html: string }): IngestionFields {
  const bodyText = deriveBodyText(input)
  return {
    bodyText,
    extractedOtp: extractOtp(bodyText),
    links: classifyLinks(extractLinks(input)),
  }
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run --project node lib/email/__tests__/derive-ingestion-fields.test.ts`
Expected: 4 passed.

- [ ] **Step 6: Use the helper in the webhook route**

In `app/api/webhooks/email/route.ts`, replace the four import lines

```ts
import { deriveBodyText } from '@/lib/email/extract-body-text'
import { extractLinks } from '@/lib/email/extract-links'
import { extractOtp } from '@/lib/email/extract-otp'
import { classifyLinks } from '@/lib/email/cta-heuristic'
```

with

```ts
import { deriveIngestionFields } from '@/lib/email/derive-ingestion-fields'
```

Replace

```ts
      const bodyText = deriveBodyText({
        text: resendEmail.text || '',
        html: resendEmail.html || '',
      })
      const links = classifyLinks(
        extractLinks({ text: resendEmail.text || '', html: resendEmail.html || '' }),
      )
```

with

```ts
      const { bodyText, extractedOtp, links } = deriveIngestionFields({
        text: resendEmail.text || '',
        html: resendEmail.html || '',
      })
```

and replace `          extractedOtp: extractOtp(bodyText),` with `          extractedOtp,`.

- [ ] **Step 7: Use the helper in the send route**

In `app/api/app/emailInbox/[id]/send/route.ts`, replace the same four import lines with the single `deriveIngestionFields` import, then replace

```ts
    const sentBodyText = deriveBodyText({ text: text || '', html: html || '' })
    const sentLinks = classifyLinks(extractLinks({ text: text || '', html: html || '' }))
```

with

```ts
    const {
      bodyText: sentBodyText,
      extractedOtp: sentOtp,
      links: sentLinks,
    } = deriveIngestionFields({ text: text || '', html: html || '' })
```

and replace `        extractedOtp: extractOtp(sentBodyText),` with `        extractedOtp: sentOtp,`.

- [ ] **Step 8: Verify nothing changed for the routes**

Run: `NODE_OPTIONS=--no-experimental-webstorage npx vitest run app/api/webhooks/email "app/api/app/emailInbox"`
Expected: same pass count as Step 1, 0 failures.

Run: `npx eslint lib/email app/api/webhooks/email/route.ts "app/api/app/emailInbox/[id]/send/route.ts"` — Expected: no output (proves no unused imports remain).
Run: `npx tsc --noEmit 2>&1 | grep -E "^(lib/email|app/api/webhooks/email/route|app/api/app/emailInbox/\[id\]/send/route)"` — Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add lib/email/derive-ingestion-fields.ts lib/email/__tests__/derive-ingestion-fields.test.ts app/api/webhooks/email/route.ts "app/api/app/emailInbox/[id]/send/route.ts"
```
Commit subject: `Extract deriveIngestionFields so ingestion paths share one extraction sequence`

---

### Task 2: Eval scaffolding and case discovery

**Files:**
- Create: `vitest.eval.config.ts`
- Create: `.env.eval.example`
- Create: `test/llm-eval/lib/types.ts`
- Create: `test/llm-eval/lib/discover.ts`
- Create: `test/llm-eval/lib/discover.selftest.ts`
- Modify: `package.json` (`scripts`)
- Modify: `.gitignore` (near line 41)
- Modify: `eslint.config.mjs` (allowlist array, next to `'vitest.integration.config.ts',`)

**Interfaces:**
- Produces (`types.ts`, used by every later task): the types below, plus `RUN_MODES`.
- Produces (`discover.ts`): `discoverCases(root: string): CaseDir[]`, `EMAIL_FILE = 'email.html'`, `OUTPUT_FILE = 'output.json'`.

- [ ] **Step 1: Create the shared types**

Create `test/llm-eval/lib/types.ts`:

```ts
import type { ClassifiedLink } from '@/lib/email/cta-heuristic'

export type RunMode = 'withoutLlm' | 'withLlm'
export const RUN_MODES: readonly RunMode[] = ['withoutLlm', 'withLlm']

export type Status = 'pass' | 'fail' | 'generated' | 'skipped'
export type Action = 'compare' | 'generate' | 'skip'

export interface CaseDir {
  /** Path relative to the cases root, with `/` separators. */
  id: string
  dir: string
  htmlPath: string
  outputPath: string
}

/** The subset of an EmailMessage row that ingestion writes and enrichment reads/writes. */
export interface EvalRow {
  id: string
  organizationId: string
  subject: string
  text: string
  html: string
  bodyText: string | null
  extractedOtp: string | null
  categories: string[]
  metadata: { links: ClassifiedLink[]; timestamps: string[] }
}

/** The stored fields a run is judged on. Ids and processing times are deliberately absent. */
export interface Snapshot {
  extractedOtp: string | null
  categories: string[]
  metadata: { links: ClassifiedLink[]; timestamps: string[] }
}

export interface SectionMeta {
  at: string
  model: string | null
}

export type StoredSection = Snapshot & { _generated?: SectionMeta }

export interface StoredOutput {
  withoutLlm?: StoredSection
  withLlm?: StoredSection
}

export interface Diff {
  path: string
  expected: unknown
  actual: unknown
}

export interface Comparison {
  failures: Diff[]
  informational: Diff[]
}

export interface RunRecord {
  caseId: string
  mode: RunMode
  status: Status
  failures: Diff[]
  informational: Diff[]
  notes: string[]
}
```

- [ ] **Step 2: Write the failing discovery test**

Create `test/llm-eval/lib/discover.selftest.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { discoverCases } from './discover'

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-eval-discover-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function touch(relativePath: string, content = ''): void {
  const file = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

const ids = () => discoverCases(root).map((c) => c.id)

describe('discoverCases', () => {
  it('finds every folder that contains an email.html, sorted by id', () => {
    touch('promo/email.html')
    touch('otp/email.html')

    expect(ids()).toEqual(['otp', 'promo'])
  })

  it('supports grouping folders: the id is the path relative to the root', () => {
    touch('security/otp-1/email.html')
    touch('security/otp-2/email.html')
    touch('marketing/promo/email.html')

    expect(ids()).toEqual(['marketing/promo', 'security/otp-1', 'security/otp-2'])
  })

  it('ignores folders without an email.html and stray files', () => {
    touch('notes/readme.md')
    touch('loose.html')
    touch('real/email.html')

    expect(ids()).toEqual(['real'])
  })

  it('gives each case its html and output.json paths', () => {
    touch('otp/email.html')

    const [found] = discoverCases(root)

    expect(found.dir).toBe(path.join(root, 'otp'))
    expect(found.htmlPath).toBe(path.join(root, 'otp', 'email.html'))
    expect(found.outputPath).toBe(path.join(root, 'otp', 'output.json'))
  })

  it('does not descend into a case folder', () => {
    touch('otp/email.html')
    touch('otp/nested/email.html')

    expect(ids()).toEqual(['otp'])
  })

  it('returns no cases for an empty root and throws for a missing one', () => {
    expect(ids()).toEqual([])
    expect(() => discoverCases(path.join(root, 'nope'))).toThrow(/does not exist/)
  })
})
```

- [ ] **Step 3: Create the config so the selftest project exists, then watch the test fail**

Create `vitest.eval.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import { config as loadDotenv } from 'dotenv'
import path from 'path'

// Loads `.env.eval` only — never `.env`, which carries the development secrets.
// override:false, so a variable exported in the shell (or injected by CI) wins
// over the file. Loaded here, not in the runner, because this module is
// evaluated before the forked test workers, which inherit this process's env.
loadDotenv({ path: path.resolve(__dirname, '.env.eval'), override: false, quiet: true })

// See vitest.config.ts for why `server-only` is aliased to its empty module.
const alias = {
  '@': path.resolve(__dirname, '.'),
  'server-only': path.resolve(__dirname, 'node_modules/server-only/empty.js'),
}

// Deliberately not referenced from vitest.config.ts: `npm test` must never see
// these files. The projects are named llm-cases / llm-selftest rather than
// anything containing the bare word "eval", which shell safety checks refuse.
export default defineConfig({
  resolve: { alias },
  test: {
    globals: true,
    projects: [
      {
        test: {
          name: 'llm-cases',
          include: ['test/llm-eval/**/*.eval.ts'],
          environment: 'node',
          globals: true,
          // One LLM round trip per case per run.
          testTimeout: 120_000,
          hookTimeout: 60_000,
          env: { LOG_LEVEL: 'silent' },
        },
        resolve: { alias },
      },
      {
        test: {
          name: 'llm-selftest',
          include: ['test/llm-eval/**/*.selftest.ts'],
          environment: 'node',
          globals: true,
          env: { LOG_LEVEL: 'silent' },
        },
        resolve: { alias },
      },
    ],
  },
})
```

Add the three scripts to `package.json` `scripts` (after `test:integration:watch`):

```json
    "eval:email": "vitest run --config vitest.eval.config.ts --project llm-cases",
    "eval:email:update": "EVAL_UPDATE=1 vitest run --config vitest.eval.config.ts --project llm-cases",
    "eval:email:selftest": "vitest run --config vitest.eval.config.ts --project llm-selftest"
```

(Add a comma after the `test:integration:watch` entry.)

Run: `npm run eval:email:selftest`
Expected: FAIL — cannot resolve `./discover`.

- [ ] **Step 4: Implement discovery**

Create `test/llm-eval/lib/discover.ts`:

```ts
import fs from 'node:fs'
import path from 'node:path'
import type { CaseDir } from './types'

export const EMAIL_FILE = 'email.html'
export const OUTPUT_FILE = 'output.json'

/**
 * A case is any folder that directly contains an `email.html`. Folders may be
 * nested to group cases (`security/otp-1`), and the id is the path relative to
 * `root`. A case folder is a leaf: nothing beneath it is searched.
 */
export function discoverCases(root: string): CaseDir[] {
  if (!fs.existsSync(root)) throw new Error(`Cases directory does not exist: ${root}`)

  const found: CaseDir[] = []

  const walk = (dir: string): void => {
    if (dir !== root && fs.existsSync(path.join(dir, EMAIL_FILE))) {
      found.push({
        id: path.relative(root, dir).split(path.sep).join('/'),
        dir,
        htmlPath: path.join(dir, EMAIL_FILE),
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

- [ ] **Step 5: Run the selftest and watch it pass**

Run: `npm run eval:email:selftest`
Expected: 6 passed.

- [ ] **Step 6: Supporting files**

Create `.env.eval.example`:

```
# Copy to .env.eval (git-ignored) and fill in. `npm run eval:email` loads that
# file automatically; a variable already exported in your shell wins over it.
#
# These are the same variables the app reads (see lib/config/schema.ts). Leave
# LLM_PROVIDER unset and the "withLlm" run is reported as SKIPPED, while the
# "withoutLlm" run still executes. Only .env.eval is read — never .env.
#
# One LLM call is made per case for the "withLlm" run, so this costs money and
# is not deterministic.
LLM_PROVIDER=anthropic
LLM_API_KEY=
# Optional. Each provider has a default model (see lib/llm/factory.ts).
# LLM_MODEL=claude-haiku-4-5-20251001
# Optional. Only for openai-compatible providers / local servers.
# LLM_BASE_URL=
```

In `.gitignore`, after the `.env.test` line, add:

```
.env.eval
```

In `eslint.config.mjs`, in the allowlist `files` array, after `'vitest.integration.config.ts',` add:

```js
      'vitest.eval.config.ts',
```

(`test/**` is already allowlisted, and the structural test in `lib/config/__tests__/no-raw-env.test.ts` already matches `vitest.eval.config.ts` through its `/^vitest[.\w]*\.config\.ts$/` pattern.)

- [ ] **Step 7: Verify the gate**

Run: `npx eslint vitest.eval.config.ts test/llm-eval eslint.config.mjs` — Expected: no output.
Run: `npx tsc --noEmit 2>&1 | grep -E "^(test/llm-eval|vitest.eval)"` — Expected: no output.
Run: `NODE_OPTIONS=--no-experimental-webstorage npx vitest run lib/config` — Expected: pass (confirms the `process.env` structural test accepts the new files).

- [ ] **Step 8: Commit**

```bash
git add vitest.eval.config.ts .env.eval.example .gitignore eslint.config.mjs package.json test/llm-eval/lib/types.ts test/llm-eval/lib/discover.ts test/llm-eval/lib/discover.selftest.ts
```
Commit subject: `Add LLM eval scaffolding: separate vitest config, scripts and case discovery`

---

### Task 3: From `email.html` to the stored row, and back to a snapshot

**Files:**
- Create: `test/llm-eval/lib/build-row.ts`
- Create: `test/llm-eval/lib/build-row.selftest.ts`

**Interfaces:**
- Consumes: `deriveIngestionFields` (Task 1); `EvalRow`, `Snapshot` (Task 2).
- Produces: `deriveSubject(html: string, fallback: string): string`; `buildRow(input: { id: string; caseId: string; html: string }): EvalRow`; `toSnapshot(row: EvalRow): Snapshot`; `EVAL_ORGANIZATION_ID`.

- [ ] **Step 1: Write the failing test**

Create `test/llm-eval/lib/build-row.selftest.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildRow, deriveSubject, toSnapshot } from './build-row'

const OTP_HTML =
  '<html><head><title>Your Acme verification code</title></head><body>' +
  '<p>Your verification code is <strong>483920</strong></p>' +
  '<a href="https://example.com/verify">Verify email</a></body></html>'

describe('deriveSubject', () => {
  it('uses the <title>', () => {
    expect(deriveSubject(OTP_HTML, 'fallback')).toBe('Your Acme verification code')
  })

  it('decodes common entities and collapses whitespace', () => {
    expect(deriveSubject('<title>\n  Code &amp; receipt &#39;24\n</title>', 'fallback')).toBe(
      "Code & receipt '24",
    )
  })

  it('falls back when there is no title or it is empty', () => {
    expect(deriveSubject('<p>hi</p>', 'fallback')).toBe('fallback')
    expect(deriveSubject('<title>   </title>', 'fallback')).toBe('fallback')
  })

  it('ignores an out-of-range numeric entity instead of throwing', () => {
    expect(deriveSubject('<title>x &#99999999; y</title>', 'fallback')).toBe('x &#99999999; y')
  })
})

describe('buildRow', () => {
  it('builds the row ingestion would store for an HTML-only email', () => {
    const row = buildRow({ id: 'security/otp:withoutLlm', caseId: 'security/otp', html: OTP_HTML })

    expect(row.id).toBe('security/otp:withoutLlm')
    expect(row.subject).toBe('Your Acme verification code')
    expect(row.text).toBe('')
    expect(row.html).toBe(OTP_HTML)
    expect(row.bodyText).toContain('483920')
    expect(row.extractedOtp).toBe('483920')
    expect(row.categories).toEqual([])
    expect(row.metadata.timestamps).toEqual([])
    expect(row.metadata.links).toEqual([
      { url: 'https://example.com/verify', label: 'Verify email', isCta: true, ctaConfidence: 'high' },
    ])
  })

  it('names the subject after the last folder segment when there is no <title>', () => {
    const row = buildRow({ id: 'x', caseId: 'security/otp-1', html: '<p>Use sign-in token A1B2C3</p>' })

    expect(row.subject).toBe('otp-1')
  })

  it('leaves extractedOtp null for a discount code', () => {
    const row = buildRow({
      id: 'x',
      caseId: 'promo',
      html: '<p>Use discount code SPRING25 for 25% off.</p>',
    })

    expect(row.extractedOtp).toBeNull()
  })
})

describe('toSnapshot', () => {
  it('copies exactly the judged fields, and detaches them from the row', () => {
    const row = buildRow({ id: 'x', caseId: 'otp', html: OTP_HTML })
    row.categories = ['Security']

    const snapshot = toSnapshot(row)
    snapshot.categories.push('Spam')
    snapshot.metadata.links[0].isCta = false

    expect(Object.keys(snapshot).sort()).toEqual(['categories', 'extractedOtp', 'metadata'])
    expect(row.categories).toEqual(['Security'])
    expect(row.metadata.links[0].isCta).toBe(true)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run eval:email:selftest`
Expected: FAIL — cannot resolve `./build-row`.

- [ ] **Step 3: Implement**

Create `test/llm-eval/lib/build-row.ts`:

```ts
import path from 'node:path'
import { deriveIngestionFields } from '@/lib/email/derive-ingestion-fields'
import type { EvalRow, Snapshot } from './types'

export const EVAL_ORGANIZATION_ID = 'eval-org'

const TITLE = /<title[^>]*>([\s\S]*?)<\/title>/i
const NAMED_ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (match, code: string) => {
      const point = Number(code)
      return point <= 0x10ffff ? String.fromCodePoint(point) : match
    })
    .replace(/&(lt|gt|quot|apos|nbsp);/g, (_, name: string) => NAMED_ENTITIES[name])
    .replace(/&amp;/g, '&')
}

/**
 * The email has no envelope in this harness — only `email.html` — so the
 * subject the LLM is shown comes from the document's <title>, falling back to
 * the caller-supplied name (the case folder).
 */
export function deriveSubject(html: string, fallback: string): string {
  const match = TITLE.exec(html)
  const title = match ? decodeEntities(match[1]).replace(/\s+/g, ' ').trim() : ''
  return title || fallback
}

/**
 * The row live ingestion would have created for this email, using the same
 * shared extraction (`deriveIngestionFields`) the webhook route uses. The
 * email is HTML-only: there is no text part, exactly like HTML-only mail.
 */
export function buildRow(input: { id: string; caseId: string; html: string }): EvalRow {
  const { bodyText, extractedOtp, links } = deriveIngestionFields({ text: '', html: input.html })
  return {
    id: input.id,
    organizationId: EVAL_ORGANIZATION_ID,
    subject: deriveSubject(input.html, path.posix.basename(input.caseId)),
    text: '',
    html: input.html,
    bodyText,
    extractedOtp,
    categories: [],
    metadata: { links, timestamps: [] },
  }
}

export function toSnapshot(row: EvalRow): Snapshot {
  return {
    extractedOtp: row.extractedOtp,
    categories: [...row.categories],
    metadata: {
      links: row.metadata.links.map((link) => ({ ...link })),
      timestamps: [...row.metadata.timestamps],
    },
  }
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `npm run eval:email:selftest`
Expected: all pass (6 discover + 8 build-row).

- [ ] **Step 5: Gate and commit**

Run: `npx eslint test/llm-eval` (no output) and `npx tsc --noEmit 2>&1 | grep -E "^test/llm-eval"` (no output).

```bash
git add test/llm-eval/lib/build-row.ts test/llm-eval/lib/build-row.selftest.ts
```
Commit subject: `Add eval row builder: email.html to the stored row and its snapshot`

---

### Task 4: The comparator

This decides pass or fail, so it has the most thorough tests.

**Files:**
- Create: `test/llm-eval/lib/compare.ts`
- Create: `test/llm-eval/lib/compare.selftest.ts`

**Interfaces:**
- Consumes: `Diff`, `Comparison`, `RunMode`, `Snapshot` (Task 2).
- Produces: `diffValues(expected: unknown, actual: unknown, path?: string): Diff[]` (ignores object keys starting with `_`); `compareSnapshots(mode: RunMode, expected: Snapshot, actual: Snapshot): Comparison`; `formatDiff(diff: Diff): string`.

- [ ] **Step 1: Write the failing test**

Create `test/llm-eval/lib/compare.selftest.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { compareSnapshots, diffValues, formatDiff } from './compare'
import type { Snapshot } from './types'

const link = {
  url: 'https://example.com/verify',
  label: 'Verify email',
  isCta: true,
  ctaConfidence: 'high' as const,
}

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  extractedOtp: '483920',
  categories: ['Security'],
  metadata: { links: [link], timestamps: [] },
  ...over,
})

describe('diffValues', () => {
  it('reports nothing for equal values', () => {
    expect(diffValues(snap(), snap())).toEqual([])
  })

  it('reports a changed primitive with its path', () => {
    expect(diffValues({ a: { b: 1 } }, { a: { b: 2 } })).toEqual([
      { path: 'a.b', expected: 1, actual: 2 },
    ])
  })

  it('reports a nested change inside an array element', () => {
    const changed = snap({ metadata: { links: [{ ...link, isCta: false }], timestamps: [] } })

    expect(diffValues(snap(), changed)).toEqual([
      { path: 'metadata.links[0].isCta', expected: true, actual: false },
    ])
  })

  it('reports an extra and a missing array element', () => {
    expect(diffValues([1, 2], [1])).toEqual([{ path: '[1]', expected: 2, actual: undefined }])
    expect(diffValues([1], [1, 2])).toEqual([{ path: '[1]', expected: undefined, actual: 2 }])
  })

  it('distinguishes null from a value', () => {
    expect(diffValues({ otp: null }, { otp: '1234' })).toEqual([
      { path: 'otp', expected: null, actual: '1234' },
    ])
  })

  it('ignores keys that start with an underscore, at any depth', () => {
    expect(diffValues({ _generated: { at: 'x' }, a: 1 }, { a: 1 })).toEqual([])
  })
})

describe('compareSnapshots: withoutLlm is fully strict', () => {
  it('passes on identical snapshots', () => {
    expect(compareSnapshots('withoutLlm', snap(), snap())).toEqual({ failures: [], informational: [] })
  })

  it.each([
    ['otp', snap({ extractedOtp: null })],
    ['categories', snap({ categories: ['Primary'] })],
    ['timestamps', snap({ metadata: { links: [link], timestamps: ['tomorrow'] } })],
    ['links', snap({ metadata: { links: [], timestamps: [] } })],
  ])('fails when %s differs', (_name, actual) => {
    expect(compareSnapshots('withoutLlm', snap(), actual).failures.length).toBeGreaterThan(0)
  })
})

describe('compareSnapshots: withLlm is strict on stable fields, tolerant on LLM ones', () => {
  it('fails when extractedOtp differs', () => {
    const { failures } = compareSnapshots('withLlm', snap(), snap({ extractedOtp: null }))

    expect(failures).toEqual([{ path: 'extractedOtp', expected: '483920', actual: null }])
  })

  it('fails when a link changes', () => {
    const actual = snap({ metadata: { links: [{ ...link, isCta: false }], timestamps: [] } })

    expect(compareSnapshots('withLlm', snap(), actual).failures).toEqual([
      { path: 'metadata.links[0].isCta', expected: true, actual: false },
    ])
  })

  it('treats categories as an unordered set', () => {
    const expected = snap({ categories: ['Security', 'Notifications'] })
    const actual = snap({ categories: ['Notifications', 'Security'] })

    expect(compareSnapshots('withLlm', expected, actual)).toEqual({ failures: [], informational: [] })
  })

  it('fails when the category set differs, showing both sets sorted', () => {
    const { failures } = compareSnapshots('withLlm', snap(), snap({ categories: ['Promotions', 'Primary'] }))

    expect(failures).toEqual([
      { path: 'categories', expected: ['Security'], actual: ['Primary', 'Promotions'] },
    ])
  })

  it('reports timestamp differences as informational only', () => {
    const actual = snap({ metadata: { links: [link], timestamps: ['in 10 minutes'] } })

    const result = compareSnapshots('withLlm', snap(), actual)

    expect(result.failures).toEqual([])
    expect(result.informational).toEqual([
      { path: 'metadata.timestamps[0]', expected: undefined, actual: 'in 10 minutes' },
    ])
  })

  it('ignores the _generated provenance block on the stored side', () => {
    const stored = { ...snap(), _generated: { at: '2026-09-18T00:00:00.000Z', model: 'anthropic:x' } }

    expect(compareSnapshots('withLlm', stored, snap())).toEqual({ failures: [], informational: [] })
  })
})

describe('formatDiff', () => {
  it('shows path, expected and actual', () => {
    expect(formatDiff({ path: 'extractedOtp', expected: '483920', actual: null })).toBe(
      'extractedOtp: expected "483920" → actual null',
    )
  })

  it('marks a missing side', () => {
    expect(formatDiff({ path: '[1]', expected: undefined, actual: 2 })).toBe(
      '[1]: expected <missing> → actual 2',
    )
  })

  it('names the root when the path is empty', () => {
    expect(formatDiff({ path: '', expected: 1, actual: 2 })).toBe('(root): expected 1 → actual 2')
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm run eval:email:selftest`
Expected: FAIL — cannot resolve `./compare`.

- [ ] **Step 3: Implement**

Create `test/llm-eval/lib/compare.ts`:

```ts
import type { Comparison, Diff, RunMode, Snapshot } from './types'

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Leaf-level differences between two JSON-like values. Object keys that start
 * with an underscore (the `_generated` provenance block) are ignored at every
 * depth. A value present on only one side is reported with `undefined` on the
 * other.
 */
export function diffValues(expected: unknown, actual: unknown, path = ''): Diff[] {
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const length = Math.max(expected.length, actual.length)
    return Array.from({ length }, (_, i) => diffValues(expected[i], actual[i], `${path}[${i}]`)).flat()
  }
  if (isPlainObject(expected) && isPlainObject(actual)) {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
      .filter((key) => !key.startsWith('_'))
      .sort()
    return keys.flatMap((key) => diffValues(expected[key], actual[key], path ? `${path}.${key}` : key))
  }
  return Object.is(expected, actual) ? [] : [{ path, expected, actual }]
}

const asSortedSet = (value: unknown): unknown =>
  Array.isArray(value) ? [...new Set(value.map(String))].sort() : value

/**
 * The comparison rules.
 *  - withoutLlm: fully deterministic, so any difference fails.
 *  - withLlm: strict on the fields the model does not decide freely
 *    (extractedOtp, links), an unordered-set comparison for categories, and
 *    timestamps are printed but never fail — the model words them freely.
 */
export function compareSnapshots(mode: RunMode, expected: Snapshot, actual: Snapshot): Comparison {
  if (mode === 'withoutLlm') {
    return { failures: diffValues(expected, actual), informational: [] }
  }

  const failures: Diff[] = [
    ...diffValues(expected.extractedOtp, actual.extractedOtp, 'extractedOtp'),
    ...diffValues(expected.metadata?.links, actual.metadata?.links, 'metadata.links'),
  ]

  const expectedCategories = asSortedSet(expected.categories)
  const actualCategories = asSortedSet(actual.categories)
  if (JSON.stringify(expectedCategories) !== JSON.stringify(actualCategories)) {
    failures.push({ path: 'categories', expected: expectedCategories, actual: actualCategories })
  }

  return {
    failures,
    informational: diffValues(expected.metadata?.timestamps, actual.metadata?.timestamps, 'metadata.timestamps'),
  }
}

const show = (value: unknown): string => (value === undefined ? '<missing>' : JSON.stringify(value))

export function formatDiff(diff: Diff): string {
  return `${diff.path || '(root)'}: expected ${show(diff.expected)} → actual ${show(diff.actual)}`
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `npm run eval:email:selftest`
Expected: all pass.

- [ ] **Step 5: Gate and commit**

Run: `npx eslint test/llm-eval` and `npx tsc --noEmit 2>&1 | grep -E "^test/llm-eval"` — no output from either.

```bash
git add test/llm-eval/lib/compare.ts test/llm-eval/lib/compare.selftest.ts
```
Commit subject: `Add eval comparator with strict, tolerant and informational rules`

---

### Task 5: Stored `output.json` and the compare / generate / skip decision

**Files:**
- Create: `test/llm-eval/lib/stored-output.ts`
- Create: `test/llm-eval/lib/stored-output.selftest.ts`

**Interfaces:**
- Consumes: `Action`, `RunMode`, `RUN_MODES`, `SectionMeta`, `Snapshot`, `StoredOutput`, `StoredSection` (Task 2).
- Produces: `readStoredOutput(file: string): StoredOutput | null`; `toSection(snapshot: Snapshot, meta: SectionMeta): StoredSection`; `writeSection(file: string, mode: RunMode, section: StoredSection): void`; `planAction(input: { stored: StoredOutput | null; mode: RunMode; llmConfigured: boolean; update: boolean }): Action`.

- [ ] **Step 1: Write the failing test**

Create `test/llm-eval/lib/stored-output.selftest.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { planAction, readStoredOutput, toSection, writeSection } from './stored-output'
import type { Snapshot, StoredOutput } from './types'

let dir: string
let file: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-eval-stored-'))
  file = path.join(dir, 'output.json')
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const snapshot = (otp: string | null): Snapshot => ({
  extractedOtp: otp,
  categories: [],
  metadata: { links: [], timestamps: [] },
})
const META = { at: '2026-09-18T00:00:00.000Z', model: null }

describe('readStoredOutput', () => {
  it('returns null when the file does not exist', () => {
    expect(readStoredOutput(file)).toBeNull()
  })

  it('reads the sections that are present', () => {
    fs.writeFileSync(file, JSON.stringify({ withoutLlm: snapshot('1') }))

    expect(readStoredOutput(file)).toEqual({ withoutLlm: snapshot('1') })
  })

  it('throws, naming the file, on invalid JSON', () => {
    fs.writeFileSync(file, '{ nope')

    expect(() => readStoredOutput(file)).toThrow(/output\.json is not valid JSON/)
  })

  it('throws when the top level is not an object', () => {
    fs.writeFileSync(file, '[]')

    expect(() => readStoredOutput(file)).toThrow(/must contain a JSON object/)
  })

  it('throws when a section is not an object', () => {
    fs.writeFileSync(file, JSON.stringify({ withLlm: 'x' }))

    expect(() => readStoredOutput(file)).toThrow(/"withLlm" must be an object/)
  })
})

describe('writeSection', () => {
  it('creates the file with just the written section', () => {
    writeSection(file, 'withoutLlm', toSection(snapshot('1'), META))

    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
      withoutLlm: { ...snapshot('1'), _generated: META },
    })
  })

  it('adds a section without touching the existing one', () => {
    writeSection(file, 'withoutLlm', toSection(snapshot('1'), META))
    const before = readStoredOutput(file)!.withoutLlm

    writeSection(file, 'withLlm', toSection(snapshot('2'), META))

    const after = readStoredOutput(file)!
    expect(after.withoutLlm).toEqual(before)
    expect(after.withLlm?.extractedOtp).toBe('2')
  })

  it('replaces only the section it is given', () => {
    writeSection(file, 'withoutLlm', toSection(snapshot('1'), META))
    writeSection(file, 'withLlm', toSection(snapshot('2'), META))

    writeSection(file, 'withLlm', toSection(snapshot('3'), META))

    const stored = readStoredOutput(file)!
    expect(stored.withoutLlm?.extractedOtp).toBe('1')
    expect(stored.withLlm?.extractedOtp).toBe('3')
  })

  it('writes withoutLlm before withLlm, indented, with a trailing newline', () => {
    writeSection(file, 'withLlm', toSection(snapshot('2'), META))
    writeSection(file, 'withoutLlm', toSection(snapshot('1'), META))

    const text = fs.readFileSync(file, 'utf8')
    expect(Object.keys(JSON.parse(text))).toEqual(['withoutLlm', 'withLlm'])
    expect(text.endsWith('}\n')).toBe(true)
    expect(text).toContain('\n  "withoutLlm"')
  })
})

describe('toSection', () => {
  it('appends the provenance block after the snapshot fields', () => {
    expect(Object.keys(toSection(snapshot('1'), META))).toEqual([
      'extractedOtp',
      'categories',
      'metadata',
      '_generated',
    ])
  })
})

describe('planAction', () => {
  const stored = (over: StoredOutput = {}): StoredOutput => ({
    withoutLlm: toSection(snapshot('1'), META),
    withLlm: toSection(snapshot('1'), META),
    ...over,
  })

  it.each([
    ['no file yet', null, 'withoutLlm', true, false, 'generate'],
    ['no file yet, LLM on', null, 'withLlm', true, false, 'generate'],
    ['section present', stored(), 'withoutLlm', true, false, 'compare'],
    ['section present, LLM on', stored(), 'withLlm', true, false, 'compare'],
    ['withLlm section missing', stored({ withLlm: undefined }), 'withLlm', true, false, 'generate'],
    ['withoutLlm section missing', stored({ withoutLlm: undefined }), 'withoutLlm', true, false, 'generate'],
    ['update forces regeneration', stored(), 'withoutLlm', true, true, 'generate'],
    ['update forces regeneration, LLM', stored(), 'withLlm', true, true, 'generate'],
    ['LLM not configured skips withLlm', stored(), 'withLlm', false, false, 'skip'],
    ['LLM not configured skips even when missing', null, 'withLlm', false, false, 'skip'],
    ['LLM not configured skips even on update', stored(), 'withLlm', false, true, 'skip'],
    ['LLM not configured does not affect withoutLlm', stored(), 'withoutLlm', false, false, 'compare'],
  ] as const)('%s', (_name, storedOutput, mode, llmConfigured, update, expected) => {
    expect(planAction({ stored: storedOutput, mode, llmConfigured, update })).toBe(expected)
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm run eval:email:selftest`
Expected: FAIL — cannot resolve `./stored-output`.

- [ ] **Step 3: Implement**

Create `test/llm-eval/lib/stored-output.ts`:

```ts
import fs from 'node:fs'
import { RUN_MODES } from './types'
import type { Action, RunMode, SectionMeta, Snapshot, StoredOutput, StoredSection } from './types'

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Returns null when the file does not exist; throws, naming the file, when it is malformed. */
export function readStoredOutput(file: string): StoredOutput | null {
  if (!fs.existsSync(file)) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${(error as Error).message}`)
  }
  if (!isObject(parsed)) {
    throw new Error(`${file} must contain a JSON object with "withoutLlm" and/or "withLlm"`)
  }

  const output: StoredOutput = {}
  for (const mode of RUN_MODES) {
    const section = parsed[mode]
    if (section === undefined) continue
    if (!isObject(section)) throw new Error(`${file}: "${mode}" must be an object`)
    output[mode] = section as unknown as StoredSection
  }
  return output
}

export function toSection(snapshot: Snapshot, meta: SectionMeta): StoredSection {
  return { ...snapshot, _generated: meta }
}

/** Read-merge-write: replaces only `mode`'s section and always writes withoutLlm first. */
export function writeSection(file: string, mode: RunMode, section: StoredSection): void {
  const merged: StoredOutput = { ...(readStoredOutput(file) ?? {}), [mode]: section }
  const ordered: StoredOutput = {}
  for (const key of RUN_MODES) {
    if (merged[key]) ordered[key] = merged[key]
  }
  fs.writeFileSync(file, `${JSON.stringify(ordered, null, 2)}\n`)
}

/**
 * What to do with one (case, mode) run.
 *  - withLlm with no provider configured: skip — never generate, never fail.
 *  - update requested, or no stored section yet: generate.
 *  - otherwise: compare against the stored section. A stored section is never
 *    overwritten without an explicit update.
 */
export function planAction(input: {
  stored: StoredOutput | null
  mode: RunMode
  llmConfigured: boolean
  update: boolean
}): Action {
  if (input.mode === 'withLlm' && !input.llmConfigured) return 'skip'
  if (input.update) return 'generate'
  return input.stored?.[input.mode] ? 'compare' : 'generate'
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `npm run eval:email:selftest`
Expected: all pass.

- [ ] **Step 5: Gate and commit**

Run: `npx eslint test/llm-eval` and `npx tsc --noEmit 2>&1 | grep -E "^test/llm-eval"` — no output from either.

```bash
git add test/llm-eval/lib/stored-output.ts test/llm-eval/lib/stored-output.selftest.ts
```
Commit subject: `Add eval output.json storage and the compare/generate/skip decision`

---

### Task 6: The seams — in-memory row store and recording provider

**Files:**
- Create: `test/llm-eval/lib/row-store.ts`
- Create: `test/llm-eval/lib/row-store.selftest.ts`
- Create: `test/llm-eval/lib/recording-provider.ts`
- Create: `test/llm-eval/lib/recording-provider.selftest.ts`
- Create: `test/llm-eval/lib/shared.ts`

**Interfaces:**
- Consumes: `EvalRow` (Task 2); `LLMProvider`, `LlmEnrichmentResult`, `EnrichOptions`, `CandidateLink` from `@/lib/llm/types`.
- Produces: `class RowStore { clear(): void; insert(row: EvalRow): void; get(id: string): EvalRow | undefined; prismaShim(): { emailMessage: { findUnique; update } } }`; `class ProviderRecorder { calls: ProviderCall[]; errors: string[]; reset(): void; last(): ProviderCall | undefined }`; `recordingProvider(inner: LLMProvider, recorder: ProviderRecorder): LLMProvider`; `interface ProviderCall { subject: string; options: EnrichOptions | undefined; result: LlmEnrichmentResult }`; and from `shared.ts` the singletons `store` and `recorder`.

- [ ] **Step 1: Write the failing row-store test**

Create `test/llm-eval/lib/row-store.selftest.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { RowStore } from './row-store'
import type { EvalRow } from './types'

const row = (id = 'r1'): EvalRow => ({
  id,
  organizationId: 'eval-org',
  subject: 's',
  text: '',
  html: '<p>x</p>',
  bodyText: 'x',
  extractedOtp: null,
  categories: [],
  metadata: { links: [], timestamps: [] },
})

let store: RowStore

beforeEach(() => {
  store = new RowStore()
})

describe('RowStore', () => {
  it('stores a copy: mutating the inserted object or a returned row does not change the store', () => {
    const original = row()
    store.insert(original)
    original.categories.push('Spam')
    store.get('r1')!.categories.push('Spam')

    expect(store.get('r1')!.categories).toEqual([])
  })

  it('returns undefined for an unknown id and clears everything on clear()', () => {
    expect(store.get('nope')).toBeUndefined()

    store.insert(row())
    store.clear()

    expect(store.get('r1')).toBeUndefined()
  })
})

describe('RowStore.prismaShim (the two calls enrichMessage makes)', () => {
  it('findUnique returns the row, or null when it does not exist', async () => {
    store.insert(row())
    const { emailMessage } = store.prismaShim()

    expect((await emailMessage.findUnique({ where: { id: 'r1' } }))?.subject).toBe('s')
    expect(await emailMessage.findUnique({ where: { id: 'nope' } })).toBeNull()
  })

  it('update merges only the provided fields and leaves the rest', async () => {
    store.insert(row())
    const { emailMessage } = store.prismaShim()

    await emailMessage.update({
      where: { id: 'r1' },
      data: { categories: ['Security'], extractedOtp: '483920' },
    })

    const updated = store.get('r1')!
    expect(updated.categories).toEqual(['Security'])
    expect(updated.extractedOtp).toBe('483920')
    expect(updated.subject).toBe('s')
    expect(updated.bodyText).toBe('x')
  })

  it('update on an unknown id throws, like Prisma would', async () => {
    const { emailMessage } = store.prismaShim()

    await expect(emailMessage.update({ where: { id: 'nope' }, data: {} })).rejects.toThrow(/no row with id nope/)
  })
})
```

- [ ] **Step 2: Write the failing recording-provider test**

Create `test/llm-eval/lib/recording-provider.selftest.ts`:

```ts
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
```

- [ ] **Step 3: Run and watch both fail**

Run: `npm run eval:email:selftest`
Expected: FAIL — cannot resolve `./row-store` and `./recording-provider`.

- [ ] **Step 4: Implement the row store**

Create `test/llm-eval/lib/row-store.ts`:

```ts
import type { EvalRow } from './types'

/**
 * A one-table stand-in for Prisma, holding exactly the calls
 * lib/llm/enrichment.ts makes (`emailMessage.findUnique` and `.update`). It is
 * the only thing faked in the eval: the extraction, the prompt, the provider,
 * acceptLlmOtp and the category/CTA merge all run for real. Rows are cloned in
 * and out, so a caller mutating what it got cannot corrupt the store.
 */
export class RowStore {
  private rows = new Map<string, EvalRow>()

  clear(): void {
    this.rows.clear()
  }

  insert(row: EvalRow): void {
    this.rows.set(row.id, structuredClone(row))
  }

  get(id: string): EvalRow | undefined {
    const row = this.rows.get(id)
    return row ? structuredClone(row) : undefined
  }

  prismaShim() {
    return {
      emailMessage: {
        findUnique: async ({ where }: { where: { id: string } }): Promise<EvalRow | null> =>
          this.get(where.id) ?? null,
        update: async ({
          where,
          data,
        }: {
          where: { id: string }
          data: Partial<EvalRow>
        }): Promise<EvalRow> => {
          const row = this.rows.get(where.id)
          if (!row) throw new Error(`RowStore: no row with id ${where.id}`)
          Object.assign(row, structuredClone(data))
          return structuredClone(row)
        },
      },
    }
  }
}
```

- [ ] **Step 5: Implement the recording provider and the shared singletons**

Create `test/llm-eval/lib/recording-provider.ts`:

```ts
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
```

Create `test/llm-eval/lib/shared.ts`:

```ts
import { ProviderRecorder } from './recording-provider'
import { RowStore } from './row-store'

/**
 * The module-level singletons the vi.mock factories and the runner share.
 * They live in their own module so both sides import the same instance.
 */
export const store = new RowStore()
export const recorder = new ProviderRecorder()
```

- [ ] **Step 6: Run and watch them pass**

Run: `npm run eval:email:selftest`
Expected: all pass.

- [ ] **Step 7: Gate and commit**

Run: `npx eslint test/llm-eval` and `npx tsc --noEmit 2>&1 | grep -E "^test/llm-eval"` — no output from either.

```bash
git add test/llm-eval/lib/row-store.ts test/llm-eval/lib/row-store.selftest.ts test/llm-eval/lib/recording-provider.ts test/llm-eval/lib/recording-provider.selftest.ts test/llm-eval/lib/shared.ts
```
Commit subject: `Add eval seams: in-memory row store and recording provider`

---

### Task 7: The report

**Files:**
- Create: `test/llm-eval/lib/report.ts`
- Create: `test/llm-eval/lib/report.selftest.ts`

**Interfaces:**
- Consumes: `RunRecord`, `RunMode`, `RUN_MODES`, `Status` (Task 2); `formatDiff` (Task 4).
- Produces: `class Report { record(record: RunRecord): void; counts(mode: RunMode): Record<Status, number>; hasFailures(): boolean; render(): string }`.

- [ ] **Step 1: Write the failing test**

Create `test/llm-eval/lib/report.selftest.ts`:

```ts
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
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm run eval:email:selftest`
Expected: FAIL — cannot resolve `./report`.

- [ ] **Step 3: Implement**

Create `test/llm-eval/lib/report.ts`:

```ts
import { formatDiff } from './compare'
import { RUN_MODES } from './types'
import type { RunMode, RunRecord, Status } from './types'

export class Report {
  private records: RunRecord[] = []

  record(record: RunRecord): void {
    this.records.push(record)
  }

  hasFailures(): boolean {
    return this.records.some((record) => record.status === 'fail')
  }

  counts(mode: RunMode): Record<Status, number> {
    const counts: Record<Status, number> = { pass: 0, fail: 0, generated: 0, skipped: 0 }
    for (const record of this.records) {
      if (record.mode === mode) counts[record.status] += 1
    }
    return counts
  }

  render(): string {
    const lines = ['', 'LLM eval — email extraction', '===========================']
    if (this.records.length === 0) {
      lines.push('No cases ran.', '')
      return lines.join('\n')
    }

    lines.push('', 'Per case')
    const caseIds = [...new Set(this.records.map((record) => record.caseId))]
    const width = Math.max(...caseIds.map((id) => id.length))
    for (const id of caseIds) {
      const cells = RUN_MODES.map((mode) => {
        const found = this.records.find((record) => record.caseId === id && record.mode === mode)
        return `${mode} ${found ? found.status.toUpperCase() : '-'}`
      })
      lines.push(`  ${id.padEnd(width)}  ${cells.join('   ')}`)
    }

    lines.push('', 'Totals')
    for (const mode of RUN_MODES) {
      const c = this.counts(mode)
      lines.push(
        `  ${mode.padEnd(10)}  ${c.pass} pass · ${c.fail} fail · ${c.generated} generated · ${c.skipped} skipped`,
      )
    }

    const detailed = this.records.filter((record) => record.status === 'fail' || record.status === 'generated')
    if (detailed.length > 0) {
      lines.push('', 'Details')
      for (const record of detailed) {
        lines.push(`${record.status.toUpperCase()}  ${record.caseId} [${record.mode}]`)
        for (const diff of record.failures) lines.push(`    ${formatDiff(diff)}`)
        for (const diff of record.informational) lines.push(`    (informational) ${formatDiff(diff)}`)
        for (const note of record.notes) lines.push(`    ${note}`)
      }
    }

    const skipped = this.records.filter((record) => record.status === 'skipped')
    if (skipped.length > 0) {
      lines.push('', `Skipped ${skipped.length} run(s): ${skipped[0].notes[0] ?? 'see notes'}`)
    }

    if (this.records.some((record) => record.status === 'generated')) {
      lines.push(
        '',
        'Generated output.json files need a human review: correct any wrong values, then commit them.',
      )
    }

    lines.push('')
    return lines.join('\n')
  }
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `npm run eval:email:selftest`
Expected: all pass.

- [ ] **Step 5: Gate and commit**

Run: `npx eslint test/llm-eval` and `npx tsc --noEmit 2>&1 | grep -E "^test/llm-eval"` — no output from either.

```bash
git add test/llm-eval/lib/report.ts test/llm-eval/lib/report.selftest.ts
```
Commit subject: `Add eval report with per-case lines, totals and diff details`

---

### Task 8: The runner, sample cases, README and end-to-end verification

The runner is wiring, verified end to end rather than by unit tests. The failure guard in `assertRunIsGenuine` is verified by Step 9.

**Files:**
- Create: `test/llm-eval/email-cases.eval.ts`
- Create: `test/llm-eval/README.md`
- Create: `test/llm-eval/cases/otp-verification-code/email.html`
- Create: `test/llm-eval/cases/promo-discount-code/email.html`
- Create: `test/llm-eval/cases/regex-miss-signin-token/email.html`
- Generated in Step 4 and committed: `test/llm-eval/cases/*/output.json`

**Interfaces:**
- Consumes everything from Tasks 2-7 plus the real `enrichMessage` (`@/lib/llm/enrichment`), `resetProviderCache` and `getProvider` (`@/lib/llm/factory`).
- Produces: the `npm run eval:email` behavior.

- [ ] **Step 1: Add the sample cases**

Create `test/llm-eval/cases/otp-verification-code/email.html`:

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Your Acme verification code</title>
  </head>
  <body>
    <p>Hi there,</p>
    <p>Your verification code is <strong>483920</strong>. It expires in 10 minutes.</p>
    <p><a href="https://example.com/verify">Verify email</a></p>
    <p>If you did not request this, you can ignore this email.</p>
    <p><a href="https://example.com/unsubscribe">Unsubscribe</a></p>
  </body>
</html>
```

Create `test/llm-eval/cases/promo-discount-code/email.html`:

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Spring sale: 25% off everything</title>
  </head>
  <body>
    <h1>Spring sale</h1>
    <p>Use discount code <strong>SPRING25</strong> at checkout for 25% off your order.</p>
    <p><a href="https://shop.example.com/sale">Shop the sale</a></p>
    <p><a href="https://shop.example.com/unsubscribe">Unsubscribe</a></p>
  </body>
</html>
```

Create `test/llm-eval/cases/regex-miss-signin-token/email.html`:

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Your Acme sign-in token</title>
  </head>
  <body>
    <p>Use sign-in token <strong>A1B2C3</strong> to continue signing in to Acme.</p>
    <p>This token expires in 10 minutes. Never share it with anyone.</p>
  </body>
</html>
```

These three are chosen deliberately: a code the regex catches, a discount code that must never become an OTP, and a phrasing ("sign-in token") the regex misses, which is what the LLM fallback exists for.

- [ ] **Step 2: Write the runner**

Create `test/llm-eval/email-cases.eval.ts`:

```ts
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
import type { CaseDir, RunMode } from './lib/types'

// The one thing faked: the two Prisma calls enrichMessage makes. Everything
// else — extraction, prompt, provider adapter, acceptLlmOtp, the Security
// gate, the CTA merge — is the real code.
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
const llmConfigured = Boolean(configuredLlmEnv.LLM_PROVIDER)
const update = process.env.EVAL_UPDATE === '1'
const modelLabel = `${configuredLlmEnv.LLM_PROVIDER ?? 'none'}:${configuredLlmEnv.LLM_MODEL ?? 'default'}`

const report = new Report()

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
    throw new Error(
      `LLM enrichment did not complete: ${
        recorder.errors.join('; ') || 'the model returned no categories, or the write failed'
      }. Nothing was written to output.json.`,
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

async function runCase(c: CaseDir, mode: RunMode, skip: () => void): Promise<void> {
  const stored = readStoredOutput(c.outputPath)
  const action = planAction({ stored, mode, llmConfigured, update })
  const relOutput = path.relative(process.cwd(), c.outputPath)

  if (action === 'skip') {
    report.record({
      caseId: c.id,
      mode,
      status: 'skipped',
      failures: [],
      informational: [],
      notes: ['LLM not configured: set LLM_PROVIDER (and LLM_API_KEY) in .env.eval'],
    })
    skip()
    return
  }

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
  assertRunIsGenuine(mode, settled)

  const actual = toSnapshot(store.get(row.id)!)
  const notes = mode === 'withLlm' ? llmNotes(row.bodyText) : [`body text seen: ${JSON.stringify((row.bodyText ?? '').slice(0, 200))}`]

  if (action === 'generate') {
    writeSection(
      c.outputPath,
      mode,
      toSection(actual, { at: new Date().toISOString(), model: mode === 'withLlm' ? modelLabel : null }),
    )
    report.record({
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
  report.record({ caseId: c.id, mode, status: failed ? 'fail' : 'pass', failures, informational, notes })

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
```

- [ ] **Step 3: Gate**

Run: `npx eslint test/llm-eval` (no output) and `npx tsc --noEmit 2>&1 | grep -E "^test/llm-eval"` (no output).

- [ ] **Step 4: First run with no LLM configured — deterministic sections are generated**

Make sure `.env.eval` does not exist and no `LLM_*` variable is exported (`env | grep LLM_` prints nothing).
Run: `npm run eval:email`
Expected: exit 0; the printed report shows, for all three cases, `withoutLlm GENERATED  withLlm SKIPPED`; totals `withoutLlm  0 pass · 0 fail · 3 generated · 0 skipped` and `withLlm     0 pass · 0 fail · 0 generated · 3 skipped`; the line `Skipped 3 run(s): LLM not configured…`; the "need a human review" reminder. Three `output.json` files now exist, each holding only a `withoutLlm` section.

- [ ] **Step 5: Review the generated files (this is the human review the tool asks for)**

Run: `cat test/llm-eval/cases/*/output.json`
Confirm, and correct by hand if any differs:
- `otp-verification-code`: `"extractedOtp": "483920"`; the Verify link `"isCta": true, "ctaConfidence": "high"`; `"categories": []`; `"timestamps": []`.
- `promo-discount-code`: `"extractedOtp": null` (the point of the case); the "Shop the sale" link `"isCta": false, "ctaConfidence": "low"`.
- `regex-miss-signin-token`: `"extractedOtp": null` (the regex misses it; the LLM run is what should recover `A1B2C3`), `"links": []`.

Then record a fingerprint for the next step: `shasum test/llm-eval/cases/*/output.json`.

- [ ] **Step 6: Second run — everything compares and passes**

Run: `npm run eval:email`
Expected: `withoutLlm  3 pass · 0 fail · 0 generated · 0 skipped`, `withLlm` still all skipped, exit 0. Run `shasum test/llm-eval/cases/*/output.json` again: identical to Step 5 (a passing run never writes).

- [ ] **Step 7: A wrong stored value fails with a diff and a non-zero exit**

Edit `test/llm-eval/cases/otp-verification-code/output.json`, changing `"extractedOtp": "483920"` to `"extractedOtp": "000000"`.
Run: `npm run eval:email`
Expected: exit code non-zero; the report shows `FAIL  otp-verification-code [withoutLlm]` with `extractedOtp: expected "000000" → actual "483920"`, and totals `2 pass · 1 fail`. The file still contains `"000000"` afterwards (a failing run never overwrites).
Then restore the value to `"483920"`.

- [ ] **Step 8: `EVAL_UPDATE` regenerates deliberately**

Change `"extractedOtp"` in the same file to `"000000"` again, then run `npm run eval:email:update`.
Expected: `withoutLlm  0 pass · 0 fail · 3 generated · 0 skipped`, and the file contains `"extractedOtp": "483920"` again (only its `_generated.at` timestamp differs from before). Run `npm run eval:email` once more and confirm `3 pass`.

- [ ] **Step 9: A failing provider fails the run and writes nothing**

Run: `LLM_PROVIDER=openai LLM_API_KEY=sk-fake LLM_BASE_URL=http://127.0.0.1:9/v1 npm run eval:email`
Expected: exit non-zero; every `withLlm` run is `FAIL` with `LLM enrichment did not complete: … Nothing was written to output.json.`; `withoutLlm` runs still `PASS`; and no `output.json` has gained a `withLlm` section (`grep -l withLlm test/llm-eval/cases/*/output.json` prints nothing). This proves a bad key cannot produce a baseline.

- [ ] **Step 10: A real LLM run (needs your API key — run this yourself)**

Copy `.env.eval.example` to `.env.eval`, set `LLM_PROVIDER` and `LLM_API_KEY`, then run `npm run eval:email`.
Expected: `withLlm` generated for all three cases. Review `categories`, and above all: `promo-discount-code` must have `"extractedOtp": null`, and `regex-miss-signin-token` should have `"extractedOtp": "A1B2C3"` if the model tagged it `Security` (the report's `llm proposed:` note shows what it returned and whether the guards accepted it). Correct anything wrong, then commit those sections.

- [ ] **Step 11: Write the README**

Create `test/llm-eval/README.md`:

````markdown
# LLM email eval

Runs each `email.html` under `cases/` through the **real** ingestion extraction
and the **real** LLM enrichment step, twice — once with no LLM, once with an
LLM — and compares the result with the `output.json` stored beside it.

It uses **no database**. The only thing faked is the two Prisma calls
`enrichMessage` makes, backed by an in-memory row. It is **not** part of
`npm test` and makes real LLM calls (cost, and some run-to-run variance).

## Run it

```bash
npm run eval:email            # run every case, compare, print a report
npm run eval:email:update     # regenerate output.json for every case (deliberate)
npm run eval:email:selftest   # unit tests for the harness itself (no LLM)
```

LLM settings come from `.env.eval` (copy `.env.eval.example`; git-ignored) or
exported variables. With no `LLM_PROVIDER`, the `withLlm` run is reported as
SKIPPED and the `withoutLlm` run still executes. `.env` is never read.

## Add a case

1. Create a folder anywhere under `cases/` (grouping folders are fine) and put
   one file in it: `email.html`.
2. Run `npm run eval:email`. The first run **generates** `output.json` from what
   the system found and reports the case as GENERATED.
3. **Review it.** The generated file is only what the system did, not what is
   right. Correct any wrong value (e.g. set `extractedOtp` to `null` for a
   promo email), then commit it. From then on it is the expected result.

The email has no envelope, so the subject shown to the LLM is the HTML
`<title>` (or the folder name), and there is no separate text part — this
exercises the HTML-only path.

## What is compared

| Field | `withoutLlm` | `withLlm` |
|---|---|---|
| `extractedOtp` | exact | exact |
| `metadata.links` (url, label, isCta, ctaConfidence) | exact | exact |
| `categories` | exact | same **set** (order ignored) |
| `metadata.timestamps` | exact | printed, **never fails** |

A stored section is never overwritten by a normal run. If `output.json` is
missing, or is missing a section (e.g. it was created before an LLM was
configured), only the missing section is generated.

## Reading the report

Each case shows `withoutLlm` and `withLlm` as PASS / FAIL / GENERATED /
SKIPPED, then totals per run, then details for every FAIL and GENERATED run: the
diffs (`path: expected … → actual …`), what the model proposed (code, evidence,
categories) next to what was stored, and the start of the text the model saw.
The process exits non-zero if anything FAILED.

A `withLlm` run whose provider call failed (bad key, network, no categories
returned) FAILS and writes nothing — it never generates a baseline.

## Before you commit a real email

`email.html` files are checked in. Remove personal data, real codes and
tokenised links first. The repository's commit hook runs a secret scanner that
may also flag real tokens in a fixture.

## Not covered

Automations, threading, attachments, plan/quota gating, the async queue and
anything database-specific. Only extraction and enrichment.
````

- [ ] **Step 12: Final verification**

Run each, expecting the stated result:
- `npm run eval:email:selftest` — all pass.
- `npm run eval:email` — `withoutLlm 3 pass`, `withLlm` all skipped (or passing if `.env.eval` is configured), exit 0.
- `NODE_OPTIONS=--no-experimental-webstorage npm run test 2>&1 | tail -6` — 0 failed. Expected: 2462 passed, 2 skipped (the PR #175 total of 2458, plus the 4 new `derive-ingestion-fields` tests).
- `NODE_OPTIONS=--no-experimental-webstorage npx vitest run --reporter=verbose 2>&1 | grep -c "llm-eval"` — prints `0` (proves the eval never enters `npm test`).
- `npx eslint test/llm-eval lib/email vitest.eval.config.ts eslint.config.mjs app/api/webhooks/email/route.ts "app/api/app/emailInbox/[id]/send/route.ts"` — no output.
- `npx tsc --noEmit 2>&1 | grep -E "^(test/llm-eval|lib/email|vitest.eval)"` — no output.

- [ ] **Step 13: Commit**

```bash
git add test/llm-eval/email-cases.eval.ts test/llm-eval/README.md test/llm-eval/cases
```
Commit subject: `Add LLM eval runner, sample cases and README`

---

## Self-Review (run against the design)

**Spec coverage**

| Requirement | Task |
|---|---|
| No database | Global constraints; Task 6 (`RowStore`), Task 8 (`vi.mock('@/lib/db')`) |
| Separate `package.json` scripts; never in `npm test` | Task 2 (scripts, separate config); Task 8 Step 12 (`grep -c` proves it) |
| Folders with `email.html` + `output.json`, fixed checked-in directory | Task 2 (`discover`), Task 8 (`cases/`) |
| Whatever live processing does | Task 1 (shared helper), Task 3 (`buildRow`), Task 8 (real `enrichMessage`) |
| Two runs, LLM off then on | Task 8 (`setLlm`, `RUN_MODES`), Task 5 (`planAction`) |
| Generate on first run | Task 5 (`planAction`, `writeSection`), Task 8 Steps 4, 6, 8 |
| Compare with stored output and show diff | Task 4, Task 7, Task 8 Step 7 |
| Success/failure counts | Task 7 (`Totals`), Task 8 Steps 4, 6, 7 |
| Comparison policy (strict / tolerant) | Task 4 |
| LLM diagnostics printed, not compared | Task 8 (`llmNotes`), Task 7 (details) |
| Shared-helper refactor | Task 1 |
| Self-test script | Tasks 2-7 (`eval:email:selftest`) |
| Bad provider must not produce a baseline | Task 8 (`assertRunIsGenuine`), Step 9 |
| `.env.eval`, ignored, example checked in | Task 2 |
| README, sample cases | Task 8 |

**Placeholder scan:** no "TBD"/"TODO"/"handle edge cases"; every code step shows the code; commit steps name exact files and subjects.

**Type consistency:** `RunMode`, `RUN_MODES`, `Snapshot`, `StoredSection`, `StoredOutput`, `RunRecord`, `Diff`, `Comparison`, `EvalRow`, `CaseDir` are defined once in Task 2's `types.ts` and imported everywhere. Function names and signatures used across tasks match their definitions: `discoverCases(root)`, `deriveSubject(html, fallback)`, `buildRow({ id, caseId, html })`, `toSnapshot(row)`, `diffValues(expected, actual, path?)`, `compareSnapshots(mode, expected, actual)`, `formatDiff(diff)`, `readStoredOutput(file)`, `writeSection(file, mode, section)`, `toSection(snapshot, meta)`, `planAction({ stored, mode, llmConfigured, update })`, `RowStore.{clear,insert,get,prismaShim}`, `ProviderRecorder.{calls,errors,reset,last}`, `recordingProvider(inner, recorder)`, `Report.{record,counts,hasFailures,render}`.

**Known limits (also in the README):** HTML-only path; sync-path semantics only (no queue); no automations/threading/attachments/plan gating; one LLM call per case per run, with some variance; fixtures need scrubbing and may trip the commit hook's secret scanner; stacked on PR #175.
