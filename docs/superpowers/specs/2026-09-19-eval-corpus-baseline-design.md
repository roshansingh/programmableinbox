# LLM eval: realistic corpus and multi-sample baselines

**Date:** 2026-09-19
**Status:** Design approved in conversation; awaiting written-spec review
**Builds on:** `docs/superpowers/plans/2026-09-18-llm-email-eval.md` (the harness, PR #177)

## Goal

Make `npm run eval:email` a solid regression baseline for the model production
runs (`gpt-4o-mini`): a corpus that resembles a real Gmail inbox rather than
seven tiny English HTML fixtures, and a baseline that does not fail at random.

Today the eval covers 3 of the 17 categories, 5 of 7 cases revolve around a
one-time code, every body is under 300 characters, and all mail is English,
HTML-only, with one or two links. The prompt truncates bodies at 4,000
characters and sends at most 10 links to the model; no case can reach either
limit.

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Baselines are **multi-sample and adaptive**: sampling continues until 8 consecutive runs add no new answer (at most `EVAL_SAMPLES`, default 30), stored as observed answers with counts. A failing comparison is **confirmed by retrying** (`EVAL_RETRIES`, default 2) before it is reported | Measured 2026-09-19: re-running the 7 existing cases 5 times against baselines `gpt-4o-mini` had itself generated reproduced 32 of 35 case-runs, yet **3 of the 5 runs were red** with no regression. Receipts' "Track your package" `isCta` flipped in 3 of 5 runs (the stored baseline was the *minority* answer); password-reset gained a second category `Primary` in 1 of 5. The OpenAI adapter sets no temperature, so this variance is production behaviour. **A fixed 5 samples was then found insufficient at corpus scale**: on the next run 5 of 29 freshly baselined cases failed (~15%), because rarer answers (a skipped link judgement, an extra category) had not been drawn yet. Hence adaptive sampling (effort goes to the noisy fields) plus retries (a rare draw from the normal tail is not a regression). |
| D2 | Each case may carry an **intent** file (author's correct answer), **report-only** | A baseline records what the code does, so known bugs would become "expected". The intent report keeps them visible without blocking a run. |
| D3 | Baseline generator is `gpt-4o-mini` at production settings (no temperature override) | It is the production model; the eval exists to detect change from it. |

## 1. Case format (additive)

Existing folders keep working unchanged.

- **Discovery.** A folder is a case if it directly contains `email.html` **or**
  `email.txt` (still a leaf). Both present = a multipart message.
- **`email.txt`** is the plain-text part. `build-row` passes `{ text, html }` to
  `deriveIngestionFields`, the same function the webhook uses, so no production
  code changes. A missing part is `''`.
- **`subject.txt`** (optional) is one line, trimmed. Precedence: `subject.txt`,
  then the HTML `<title>`, then the folder name (today's behaviour).
- **`intent.json`** (optional): `{ "categories": ["Security"], "otp": "483920" | null, "note": "why" }`.
  Categories are validated against `EMAIL_CATEGORIES`; a malformed file throws,
  naming the file (as `stored-output.ts` does).

## 2. Baseline storage and comparison

**`withoutLlm`** is deterministic: single sample, unchanged.

**`withLlm`** gains, alongside the existing snapshot fields:

```jsonc
{
  "extractedOtp": "A1B2C3",            // mode across samples (readability; unchanged shape)
  "categories": ["Security"],          // mode
  "metadata": { "links": [...], "timestamps": [...] },   // per-link mode; timestamps from sample 1
  "samples": 5,
  "observed": {
    "categories":   [{ "value": ["Security"], "count": 4 }, { "value": ["Primary","Security"], "count": 1 }],
    "extractedOtp": [{ "value": "A1B2C3", "count": 5 }],
    "links": { "https://…/track": [{ "value": { "isCta": true,  "ctaConfidence": "high" }, "count": 2 },
                                    { "value": { "isCta": false, "ctaConfidence": "high" }, "count": 3 }] }
  },
  "_generated": { "at": "…", "model": "openai:gpt-4o-mini" }
}
```

- **Mode rule** is deterministic: highest count; ties broken by the lexicographically
  smallest JSON encoding, so regeneration is stable. It applies per field: each
  link's stored `isCta`/`ctaConfidence` is that link's own mode, and the stored
  `timestamps` come from sample 1 (they are informational).
- **Backward compatible:** a section with no `observed` compares exactly as
  today, so the 7 existing files work until regenerated.
- **Pass rule is per field**, not whole-snapshot. With N=5, joint combinations
  are sparse and would recreate the flakiness. A run passes when: its categories
  (as a set) equal one observed set; its `extractedOtp` equals one observed
  value; and each link's `{isCta, ctaConfidence}` equals one observed state for
  that URL. Anything else fails, exactly as now.
- **Timestamps** stay informational and never fail.
- **Warnings (informational, never fail):** an accepted answer seen in fewer than
  half the baseline samples; and an "Unstable cases" list (any field with more
  than one observed value).
- **Generation.** `eval:email:update`, or a case with no stored section, runs
  `withLlm` repeatedly per case, each a full `enrichMessage` on a fresh row, so
  the existing "exactly one provider call per run" guard holds per sample.
  Sampling stops once `PATIENCE` (8) consecutive samples add no new answer key
  (`answerKeys`: the category set, the OTP, each link state), and never exceeds
  `EVAL_SAMPLES` (30). A fully stable case therefore costs 9 samples; a noisy one
  keeps going. If **any** sample fails with a provider error, or the provider is
  unreachable, nothing is written for that case and the failure is reported. A
  baseline is never built from a partial set.
  A model answer with **no valid category** is *not* such a failure. Enrichment
  throws on it (production refunds and retries), but the eval records it as an
  observed answer (`categories: []`), because it happens at a real rate: on the
  plain-text notification case `gpt-4o-mini` answered "Correspondence", a name
  not in the list, in 2 of 12 calls, so a strict rule made that case impossible
  to baseline (5 samples all succeed only ~40% of the time). This is
  `classifyLlmRun` in `lib/run-outcome.ts`.
- **Confirm before failing.** A `withLlm` comparison that fails is repeated up to
  `EVAL_RETRIES` (2) more times (`compareWithRetries`) and is reported as a
  failure only if *every* attempt fails. A pass after a failure stays visible as
  a `(warning)` naming the attempt and the failing fields. `withoutLlm` is
  deterministic and gets one attempt. An error thrown by an attempt (a provider
  failure) is not retried.

**Stated limits:** this detects *new* behaviour, not a shift in probability. A
regression that moves an answer from 80% to 30% of runs still passes, with a
warning. Retrying adds a second blind spot: a change that makes the model give an
unseen answer only some of the time (per attempt probability p) escapes with
probability 1 − p³. `EVAL_RETRIES=0` restores strict single-attempt comparison.

## 3. Intent report (never fails a run)

A new report section, "Baseline vs intent", lists each case whose baseline
disagrees with its `intent.json`: categories (set comparison against the
baseline mode) and OTP (against the stored `extractedOtp`; the `withoutLlm`
value when no LLM ran). It never changes a case's status or the exit code.

## 4. Corpus

Synthetic only: `example.com`, "Acme", invented names, no real tokens, addresses
or personal data (the commit hook runs a secret scanner). Existing 7 cases stay
in place so their ids and history are stable. Each new case ships with an
`intent.json`. **58 new cases, 65 total.**

**`categories/<category>/<variant>`, 34 cases:** two per category, a plain
variant and a boundary variant.

| Category | Cases |
|---|---|
| Primary | `personal-plan`, `quoted-reply-chain` |
| Promotions | `flash-sale`, `loyalty-points-offer` |
| Social | `linkedin-invite` (button "View on LinkedIn"), `instagram-comment` |
| Receipts | `subscription-invoice`, `shipping-delivered` |
| Finance | `card-alert`, `payment-failed` |
| Travel | `flight-itinerary`, `hotel-confirmation` |
| Support | `ticket-reply`, `ticket-resolved-survey` |
| Newsletters | `editorial-digest`, `essay-substack-style` |
| Communities | `reddit-digest`, `discord-mentions` |
| Security | `new-device-alert`, `two-factor-enabled` |
| Scheduling | `calendar-invite`, `appointment-reminder` |
| Applications | `application-received`, `interview-request` |
| Notifications | `ci-build-failed`, `document-shared` |
| Education | `course-digest`, `assignment-due` |
| Agents | `agent-outreach`, `agent-to-agent-handoff` |
| Urgent | `service-outage`, `account-suspension-deadline` |
| Spam | `prize-scam`, `phishing-lookalike` |

**`otp/<variant>`, 14 cases**, each derived from an input observed to be
mishandled today (see "Known gaps"): `booking-confirmation-code`,
`coupon-code-with-colon`, `brand-in-the-middle`, `spaced-no-qualifier`,
`spanish-verification`, `german-verification`, `french-verification`,
`two-codes-old-and-new`, `magic-link-and-code`, `zero-width-digits`,
`digit-per-table-cell`, `forwarded-stale-code`, `phishing-with-code`,
`friend-gate-code`.

**`structure/<variant>`, 10 cases:** `long-marketing-template` (10 KB+: `<style>`,
preheader, tracking pixel, 30+ links, past the 4,000-character cap),
`many-image-only-links-first` (10-link cap), `otp-beyond-4000-chars`,
`text-only-plain`, `multipart-differing-parts`, `image-only-promo`,
`bounce-notice`, `out-of-office`, `subject-re-fwd`, `entities-rtl-emoji`.

## 5. Process and delivery

- Branch `worktree-eval-corpus` off `main`, separate from the Ollama fix.
- **Wave 1:** harness changes (test-first, via `npm run eval:email:selftest`),
  regenerate the 7 existing baselines multi-sample, plus **8 exemplar cases**
  spanning every new input (`promotions/flash-sale`, `social/linkedin-invite`,
  `primary/quoted-reply-chain`, `finance/payment-failed`, `spam/phishing-lookalike`,
  `otp/booking-confirmation-code`, `structure/text-only-plain`,
  `structure/long-marketing-template`). **Pause for review** of realism and style.
- **Wave 2:** the remaining 29 category cases. **Wave 3:** the remaining 21 cases
  (13 `otp`, 8 `structure`). 8 + 29 + 21 = the 58 new cases.
- **Cost** (estimate): a full baseline is roughly 700-1,000 calls (stable cases
  9, noisy ones up to 30), about $0.15-0.25. Each subsequent eval run is about
  $0.03 (65 calls, plus retries for the few that fail). Only synthetic emails are
  sent to OpenAI.

## 6. Testing

Harness logic is test-first in the existing selftests: discovery (`email.txt`
only, both, neither), subject precedence, `intent.json` validation, mode and tie
rule, per-field compare with `observed`, backward compatibility with a legacy
section, warnings and the unstable list, the intent report, multi-sample
generation with a fake provider, and the all-or-nothing failure rule.

**Acceptance:** `npm test` and `npm run eval:email:selftest` green; three
consecutive `gpt-4o-mini` runs against freshly generated baselines, with no
failures in at least two of three. Any failure is investigated as baseline
under-sampling (regenerate that case with a higher `EVAL_SAMPLES`) or a real
change.

## Known gaps the corpus will surface (follow-ups, not fixed here)

Verified 2026-09-19 by running the real extractors. The intent report will list
these; fixing them is separate work.

| Input | Today | Intended |
|---|---|---|
| Airline/hotel "confirmation code is HK7X2M" | stored as an OTP | not an OTP |
| "Your exclusive code: 482913 takes 20% off" | stored as an OTP | not an OTP |
| Friend's "gate code is 4821" | stored as an OTP | not an OTP (judgement) |
| es / de / fr verification codes | missed by the regex; the LLM guard rejects a correct proposal | recovered |
| "G-123456 is your Google verification code" | missed | recovered |
| "Your Apple ID Code is: 837 412" | missed; the LLM guard rejects a correct proposal | recovered |
| Button "View on LinkedIn" / "Reply on Facebook" | `isCta: false`, high confidence, never sent to the model | the main action |
| Logos and icons with no text | all low confidence; only the first 10 reach the model, so they can crowd out the real button | real CTA reaches the model |

## Out of scope

Changing the production prompt or adapters; fixing the gaps above; CI
integration; latency or cost dashboards; attachments, threading and the queue
(already out of scope in the eval README). Pinning a dated model snapshot is
possible later; `_generated.model` and `_generated.at` are recorded so drift is
detectable.
