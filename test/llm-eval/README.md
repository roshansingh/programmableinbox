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
npm run eval:email:update     # regenerate output.json for every case (deliberate; see below)
npm run eval:email:selftest   # unit tests for the harness itself (no LLM)
```

LLM settings come from `.env.eval` (copy `.env.eval.example`; git-ignored) or
exported variables. With no `LLM_PROVIDER`, the `withLlm` run is reported as
SKIPPED and the `withoutLlm` run still executes. `.env` is never read.
A provider other than `ollama` also needs `LLM_API_KEY`; with the key blank the
`withLlm` run is skipped.

`eval:email:update` regenerates every section it runs. With an LLM configured
that includes `withLlm`, so it overwrites human-reviewed `withLlm` baselines with
fresh, non-deterministic model output — review the result before committing.

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
| `metadata.links` (url, label, isCta, ctaConfidence) | exact | exact, **including** the `isCta`/`ctaConfidence` the model sets on low-confidence links |
| `categories` | exact | same **set** (order ignored) |
| `metadata.timestamps` | exact | printed, **never fails** |

In a `withLlm` run, enrichment rewrites `isCta` and forces `ctaConfidence` to
`high` on every low-confidence link the model judged, so a model flip of a link
judgment fails the run. That is intentional.

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
