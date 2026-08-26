# ProgrammableInbox SDKs

Generated client libraries for the [ProgrammableInbox v1 API](https://app.programmableinbox.com/api-docs), one per language. All five are generated from the same source of truth, `lib/openapi/email-inboxes.ts`, via [OpenAPI Generator](https://github.com/OpenAPITools/openapi-generator).

| Language | Path | Package |
|---|---|---|
| Python | [`python/`](python/README.md) | `programmableinbox` |
| Go | [`go/`](go/README.md) | `github.com/roshansingh/programmableinbox/sdk/go` |
| TypeScript | [`typescript/`](typescript/README.md) | `@programmableinbox/sdk` |
| Java | [`java/`](java/README.md) | `com.programmableinbox:sdk` |
| C# | [`csharp/`](csharp/README.md) | `ProgrammableInbox.Sdk` |

## Auth

Every endpoint takes an API key created from the dashboard (`sk_live_...`) as a bearer token. Each language's README shows exactly how to set it.

## Regenerating

```bash
npm run sdk:generate
```

Regenerates all five clients from the current `lib/openapi/email-inboxes.ts`. Each `sdk/<lang>/README.md` is hand-written and is not touched by regeneration (see each directory's `.openapi-generator-ignore`) — edit those directly.

## Publishing

`.github/workflows/release.yml` (issue #130, superseding #124) publishes these on every
`vX.Y.Z` app tag — but only the SDKs that actually changed. Each language's own manifest version
is the source of truth for whether it releases that round (`pyproject.toml`, `package.json`,
`pom.xml`, the C# `.csproj`, and Go's `go/VERSION`, since Go has no manifest field to hold one):
the workflow checks whether that version is already live on the registry and publishes only if
it isn't. A maintainer bumps a language's version by hand as part of the PR that changes that
SDK — the pipeline never decides version numbers or diffs generated output, so a release with no
SDK changes publishes zero SDK packages.

Registry provisioning (PyPI/npm/Maven Central/NuGet accounts and tokens) is tracked separately —
see the checklist in issue #130 — so until that's done, and until a maintainer bumps a version,
the workflow's per-language jobs skip cleanly. Until then, everything here remains usable directly
from a checkout (`pip install ./sdk/python`, a Go `replace` directive, `npm link`, a local
Maven/NuGet install, etc.).

### Publishing by hand (Python, TypeScript)

`npm run sdk:publish -- <python|typescript> [--dry-run] [--force]` builds and publishes
outside of a tag — a Python-only fix, or rehearsing before trusting a real tag to do it.
It's `scripts/release/publish-sdk.mjs`, which shares its "is this version already
published?" check with the CI job (`scripts/release/registry-status.mjs`), so the two
can't quietly disagree.

- `--dry-run` builds and verifies the package, prints what it would publish, never uploads.
  Needs no credentials.
- Without `--dry-run`, it publishes for real: Python reads `PYPI_API_TOKEN` if set
  (otherwise falls back to twine's own config/prompt); TypeScript reads `NPM_TOKEN` if set,
  via a throwaway auth file rather than a persistent `.npmrc` (otherwise publishes under
  whatever `npm login` session already exists locally).
- `--force` skips the already-published check (the registry itself still refuses a
  real re-upload) — useful for rehearsing a build against a version that's already live.

Java and C# aren't wired up for manual publishing here; use the CI workflow (once its
Maven/NuGet prerequisites are provisioned — see issue #130) or the registry's own
`mvn deploy` / `dotnet nuget push` by hand.
