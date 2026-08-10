# ProgrammableInbox SDKs

Generated client libraries for the [ProgrammableInbox v1 API](https://app.programmableinbox.com/api-docs), one per language. All five are generated from the same source of truth, `lib/openapi/email-inboxes.ts`, via [OpenAPI Generator](https://github.com/OpenAPITools/openapi-generator).

| Language | Path | Package |
|---|---|---|
| Python | [`python/`](python/README.md) | `programmableinbox` |
| Go | [`go/`](go/README.md) | `github.com/roshansingh/programmableinbox-go` |
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

Not yet wired up. SDKs here are usable directly from a checkout (`pip install ./sdk/python`, a Go `replace` directive, `npm link`, a local Maven/NuGet install, etc.). Registry publishing (PyPI/npm/Maven Central/NuGet) triggered by a version tag is tracked as follow-up work in [issue #124](https://github.com/roshansingh/programmableinbox/issues/124).
