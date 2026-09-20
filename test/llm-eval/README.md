# LLM email eval

Runs each `email.html` under `cases/` through the **real** ingestion extraction
and the **real** LLM enrichment step, twice — once with no LLM, once with an
LLM — and compares the result with the `output.json` stored beside it.

It uses **no database**. The only thing faked is the handful of Prisma calls
`enrichMessage` makes (`findUnique`, `update`, the guarded `updateMany` and the
array form of `$transaction`), backed by an in-memory row. If `enrichMessage`
starts making another Prisma call, `lib/row-store.ts` must learn it too. It is **not** part of
`npm test` and makes real LLM calls (cost, and some run-to-run variance).

## Run it

```bash
npm run eval:email            # run every case, compare, print a report
npm run eval:email:update     # regenerate output.json for every case (deliberate; see below)
npm run eval:email:selftest   # unit tests for the harness itself (no LLM)
```

LLM settings come from `.env.eval` (copy `.env.eval.example`; git-ignored) or
exported variables. With no `LLM_PROVIDER`, the `withLlm` run is reported as
SKIPPED and the `withoutLlm` run still executes. `.env` is never read.
A provider other than `ollama` also needs `LLM_API_KEY`; with the key blank the
`withLlm` run is skipped. A `LLM_PROVIDER` that is not one of `anthropic`,
`openai`, `openrouter` or `ollama` is a failure, not a skip, whatever the key
holds: a typo must not look like an unconfigured run.

`eval:email:update` regenerates every section it runs. With an LLM configured
that includes `withLlm`, so it overwrites human-reviewed `withLlm` baselines with
fresh, non-deterministic model output — review the result before committing.

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

Cases are grouped by folder: `cases/categories/<category>/<variant>` (one or
more emails per category), `cases/otp/<variant>` (code-extraction traps and
formats) and `cases/structure/<variant>` (long templates, text-only, multipart,
image-only, bounces).

## What is compared

| Field | `withoutLlm` | `withLlm` |
|---|---|---|
| `extractedOtp` | exact | a value the baseline saw |
| `metadata.links` (url, label, isCta, ctaConfidence) | exact | url and label exact; `isCta`/`ctaConfidence` a state the baseline saw for that link |
| `categories` | exact | a **set** the baseline saw (order ignored) |
| `metadata.timestamps` | exact | printed, **never fails** |

A `withLlm` baseline records every answer the model gave across its samples
(`observed`, with counts) alongside the most frequent one. A run passes when
each field is a value the baseline **saw**, so ordinary run-to-run variance does
not fail it (a single-sample baseline left most runs red: `gpt-4o-mini`
disagreed with its own baseline). An answer the baseline saw in under half its
samples passes with a `(warning)`. This detects *new* behaviour, not a shift in
probability. A section with no `observed` (an older file) is compared exactly.

In a `withLlm` run, enrichment rewrites `isCta` and forces `ctaConfidence` to
`high` on every low-confidence link the model judged, which is why link state is
compared at all.

A stored section is never overwritten by a normal run. If `output.json` is
missing, or is missing a section (e.g. it was created before an LLM was
configured), only the missing section is generated. Writing one section leaves
the other section's contents untouched, but unknown top-level keys added to
`output.json` by hand are dropped the next time any section is written.

## Reading the report

Each case shows `withoutLlm` and `withLlm` as PASS / FAIL / GENERATED /
SKIPPED, then totals per run, then details for every FAIL and GENERATED run: the
diffs (`path: expected … → actual …`), what the model proposed (code, evidence,
categories) next to what was stored, and the start of the text the model saw.
Informational diffs (the `withLlm` timestamps) are shown under Details even when
the run PASSES; a passing run with none gets no details. The process exits
non-zero if anything FAILED.

A `withLlm` run whose provider call failed (bad key, network, no categories
returned) FAILS and writes nothing — it never generates a baseline.

## Before you commit a real email

`email.html` files are checked in. Remove personal data, real codes and
tokenised links first. The repository's commit hook runs a secret scanner that
may also flag real tokens in a fixture.

## Not covered

Automations, threading, attachments, plan/quota gating, the async queue and
anything database-specific. Only extraction and enrichment.
