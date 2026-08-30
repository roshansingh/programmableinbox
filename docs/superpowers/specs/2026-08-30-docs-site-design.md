# Public documentation site — design

**Status:** DRAFT — pending user review
**Date:** 2026-08-30

## Problem

ProgrammableInbox has documentation, but it's scattered and audience-mismatched
for anyone outside this codebase: `README.md`, `docs/architecture/*.md` (written
for contributors, not consumers), `sdk/README.md`, and per-SDK generated
READMEs. There is no single place a prospective user or self-hoster can go to
understand what the product does, how to run it, how to call the API, or how
to use the SDKs and MCP server — and no per-endpoint API reference with code
samples, which is now table stakes for a developer-facing API product.

## Goal

Publish `docs.programmableinbox.com`: a documentation site covering what the
project solves, how to use it, how to self-host it, SDK usage, MCP setup, and
a full REST API reference generated from the existing OpenAPI spec — free to
run indefinitely, with no vendor lock-in.

## Non-goals

- Replacing `docs/architecture/*.md` — those stay as contributor-facing
  internal docs describing *why* the code is built the way it is. The public
  site is consumer-facing and describes *how to use* the product.
- Replacing `deploy/runbooks/*` — incident-response material, not public.
- API versioning UI — the API is single-version (`v1`) today; the site ships
  with Docusaurus's default unversioned ("current") docs, revisited if/when a
  `v2` exists.
- A marketing/landing page distinct from the docs homepage — the docs
  homepage's overview page serves that role for v1.

## Decision

**Docusaurus, deployed statically to GitHub Pages**, using the
`docusaurus-plugin-openapi-docs` plugin to generate the API reference directly
from `sdk/openapi.json` (exported on demand from the committed
`lib/openapi/email-inboxes.ts` — see OpenAPI reference generation below).

Rationale (full comparison and research trail discussed in conversation, not
reproduced here):

- The OpenAPI plugin generates per-endpoint pages with **six code-sample
  tabs: curl, Python, Go, Node.js, Java, and C#**. Four of those —
  Python, Go, Node.js, and C# — are overridden per operation with the
  `x-codeSamples` vendor extension to show actual SDK usage (the real
  generated client call) rather than a generic HTTP-library snippet. curl
  and Java both keep the plugin's generic, auto-generated sample: curl
  because there's no SDK for raw HTTP, Java because its SDK's publishing
  leg is currently disabled — only Python, Go, TypeScript, and C# are
  actually published today. See Content architecture, API Reference, below.
- Fully static output deploys to GitHub Pages for free, indefinitely, with a
  single DNS record — no vendor ToS risk. (Vercel's free Hobby tier is
  contractually non-commercial-use-only, which conflicts with this project's
  paid EE tier; ruled out on that basis alone.)
- SaaS docs platforms (Mintlify, ReadMe, GitBook) were evaluated and rejected:
  ReadMe has no free path to a custom domain at all; GitBook's free custom
  domain requires recurring review and a non-removable badge; Mintlify is a
  legitimate fallback (free custom domain, no badge) but trades away
  self-hosting and full content ownership for marginally less setup effort.
- Fumadocs (Next.js-native, could live inside the existing app) was evaluated
  and rejected for this iteration: its OpenAPI plugin only natively covers
  curl/JS/Python (Go/Java/C# need hand-written `x-codeSamples`), and it is a
  single-maintainer project — more bus-factor risk than Docusaurus for a doc
  site meant to need minimal upkeep.

## Content architecture

Sidebar structure, in order, with source material noted:

1. **Introduction**
   - Overview — what problem this solves, who it's for (from `README.md`)
   - Core concepts — inboxes, threading, organizations (new page, distilled
     from `docs/architecture/multi-tenancy-and-api-keys.md` and
     `docs/architecture/email-ingestion-and-search.md`, stripped of
     implementation detail)
   - Quickstart (Docker) — from `docs/quickstart-docker.md` (currently on the
     `worktree-ce-quickstart-guide` branch, not yet merged to `main`; this
     project pulls it in once that branch merges, or migrates its content
     directly if merge timing doesn't line up)

2. **Self-Hosting**
   - Requirements & installation
   - Configuration — curated, user-facing subset of `.env.example` (required
     vars, common optional ones); the full `lib/config/` design rationale
     stays in `docs/architecture/configuration.md`, not duplicated here
   - Production deployment — distilled from `deploy/README.md` and
     `deploy/Caddyfile` (Caddy, TLS, Postgres tuning), not the incident
     runbooks
   - Upgrading

3. **Using ProgrammableInbox**
   - Creating & managing inboxes
   - Search (full-text, tags, categories) — from
     `docs/architecture/email-ingestion-and-search.md`, consumer framing
   - Automations
   - Webhooks (sync vs. async ingestion) — from
     `docs/architecture/async-webhook-processing.md` and
     `docs/async-webhook-processing-operator-guide.md`
   - Organizations & API keys — user-facing: what each scope grants, not the
     type-level enforcement mechanism

4. **API Reference** (generated)
   - Authentication & scopes — hand-written intro page
   - Endpoint pages — generated by `docusaurus-plugin-openapi-docs` from
     `sdk/openapi.json`. Today that's 8 operations under one tag
     ("Email Inboxes"); the plugin groups by OpenAPI tag automatically, so
     new tags create new sidebar categories with no docs-side change needed
     as the API grows.
   - Code samples per operation: curl and Java both use the plugin's generic
     HTTP sample (curl has no SDK to show; Java's SDK isn't currently
     published — see below). Python, Go, Node.js, and C# each show the real
     SDK call instead, via an `x-codeSamples` array added to every operation
     in `lib/openapi/email-inboxes.ts` (the source `sdk/openapi.json` is
     exported from — see OpenAPI reference generation). Each sample is
     written against that language's actual generated client, not a
     hand-guessed approximation — the SDK sources under `sdk/<language>/`
     are the reference for exact method names and call shape.

5. **SDKs**
   - Overview / install matrix — **Python, Go, TypeScript, and C# only.**
     The Java SDK exists in the repo but its publishing leg is currently
     disabled in the release pipeline, so it isn't actually installable;
     documenting it as available would send a reader to a package that
     doesn't exist. Add its page back once Java publishing resumes.
   - One page each: Python, Go, TypeScript, C# — install, auth, one runnable
     example, link into the API Reference. Source: `sdk/README.md` and the
     per-SDK generated READMEs, rewritten for this audience rather than
     copied verbatim (the generated READMEs are written for a package
     registry reader, not a docs reader).

6. **MCP**
   - What is MCP & why use it
   - Setup per client — Claude Code, Claude Desktop, Cursor, VS Code (from
     `docs/architecture/mcp-server.md#setup`)
   - Tool reference — the six `pibx_email_*` tools, arguments, examples (from
     `docs/architecture/mcp-server.md`)

7. **Reference**
   - Response envelope & error format
   - Rate limits (auth endpoints today; note as it stands, not aspirational)
   - Changelog

## Repository layout

Per this repo's worktree requirement, implementation happens in a git
worktree off `main`, on a new branch (e.g. `feat/docs-site`).

New top-level directory: **`website/`** (Docusaurus's own convention,
avoiding collision with the existing `docs/` directory, which stays as
contributor-facing internal docs and is not touched or moved).

```
website/
  docusaurus.config.ts
  sidebars.ts
  src/                # landing overrides, custom React bits (kept minimal)
  docs/
    introduction/
    self-hosting/
    using-programmableinbox/
    sdks/
    mcp/
    reference/
  api/                 # generated by docusaurus-plugin-openapi-docs — gitignored
  static/
    CNAME              # contains "docs.programmableinbox.com"
  package.json         # separate from the root app's package.json
```

`website/` gets its own `package.json` and its own `node_modules` — it is a
static site with a different dependency tree (React 18, since Docusaurus
hasn't moved to 19) from the main Next.js/React 19 app, and must not be
folded into the root workspace's install or build.

## OpenAPI reference generation

`sdk/openapi.json` is the single source the five SDKs are generated from,
but it is **gitignored, not committed** — it's produced on demand by
`npm run sdk:export-spec` (repo root), which serializes the real source of
truth, `lib/openapi/email-inboxes.ts` (a committed TypeScript module). The
docs site becomes a consumer of the same generation step, not of a checked-in
file:

- CI (and any local docs build) runs `npm run sdk:export-spec` at the repo
  root before building `website/`, producing a fresh `sdk/openapi.json`.
- `docusaurus gen-api-docs` then runs against `../sdk/openapi.json` as part
  of the docs build (`npm run build` inside `website/`), regenerating the API
  reference from that freshly-exported spec every time the site builds.
- No separate drift-detection step is needed: because both the export and
  the docs regeneration happen on every build from the same committed
  source (`lib/openapi/email-inboxes.ts`), the API reference is automatically
  as current as the last commit to `main` — the same guarantee the 5 SDKs
  already have, and for the same reason (one source, regenerated on demand).

## Build & deploy

New GitHub Actions workflow, `.github/workflows/docs.yml`:

- Trigger: push to `main` touching `website/**` or `sdk/openapi.json`, plus
  `workflow_dispatch` for manual redeploys.
- Steps: checkout → `npm ci` inside `website/` → `npm run build` (runs the
  OpenAPI generation as part of the build) → `actions/deploy-pages` to
  publish `website/build`.
- GitHub Pages source is set to "GitHub Actions" (not the legacy branch
  deploy), in repo settings.
- `website/static/CNAME` ships the custom domain so it survives every deploy.
`docusaurus.config.ts` sets `url: 'https://docs.programmableinbox.com'` and
`baseUrl: '/'` — not the project-name path Docusaurus's own GitHub Pages
deploy guide defaults to, which is only correct for the *default*
`username.github.io/reponame` URL and would break every asset path once a
custom domain is in front of it.

## Domain & DNS

One record, added by whoever controls DNS for `programmableinbox.com`:

```
docs.programmableinbox.com  CNAME  roshansingh.github.io
```

GitHub issues and renews HTTPS for the custom domain automatically once the
CNAME resolves and "Enforce HTTPS" is enabled in repo Pages settings. This is
a manual, operator-side step outside the PR — the PR ships the CNAME file and
the repo-settings change; the DNS record itself is called out as a follow-up
action in the PR description, not something CI can do.

## Search

Deferred to a fast-follow rather than blocking launch: apply to
[Algolia DocSearch](https://docsearch.algolia.com/) (free for open-source
docs) once the site is live and crawlable. Ship v1 with Docusaurus's built-in
local search plugin (`@easyops-cn/docusaurus-search-local`) so search isn't
missing at launch, and swap to DocSearch when the application is approved.

## Testing / validation

- `npm run build` inside `website/` must succeed with zero broken links
  (Docusaurus's `onBrokenLinks: 'throw'` config, set from the start).
- Manual review of the generated API reference pages against the live spec
  (8 operations, correct request/response schemas, all 6 code-sample tabs
  render, and the four SDK-backed languages — Python, Go, Node.js, C# —
  show the real client call rather than a generic HTTP snippet).
- Because `lib/openapi/email-inboxes.ts` is main-app source, not `website/`
  content, the root `npm run test` suite runs after any change to it — the
  same pre-PR requirement as any other app-code change.
- Manual pass through each migrated content page against its source doc to
  confirm no meaning was lost in the audience rewrite.
- Local `npm run serve` smoke test of self-hosting instructions actually
  followed start-to-finish on a clean checkout, before merge.

## Rollout

1. Implement in a worktree on `feat/docs-site`.
2. Open a PR against `main`; existing `npm run test` at the repo root is
   unaffected (new directory, no shared build).
3. On merge, the new Actions workflow deploys to GitHub Pages automatically.
4. Verify the `*.github.io` default URL serves correctly.
5. Add the DNS CNAME record (operator action, above), enable "Enforce HTTPS"
   once it issues.
6. Confirm `docs.programmableinbox.com` resolves and serves over HTTPS.
