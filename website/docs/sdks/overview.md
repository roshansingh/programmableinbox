---
sidebar_position: 1
title: Overview
---

# SDKs

Client libraries are generated from the same
[OpenAPI spec](https://github.com/roshansingh/programmableinbox/blob/main/lib/openapi/email-inboxes.ts)
that backs the [API Reference](../api-reference/authentication-and-scopes),
so every SDK covers the same operations.

| Language | Package | Install |
|---|---|---|
| [Python](python) | `programmableinbox` on PyPI | `pip install programmableinbox` |
| [Go](go) | `github.com/roshansingh/programmableinbox/sdk/go` | `go get github.com/roshansingh/programmableinbox/sdk/go` |
| [TypeScript](typescript) | `@programmableinbox/sdk` on npm | `npm install @programmableinbox/sdk` |
| [C#](csharp) | `ProgrammableInbox.Sdk` on NuGet | `dotnet add package ProgrammableInbox.Sdk` |

All four default to `https://app.programmableinbox.com`. Point at a
self-hosted or local instance by overriding the base URL/host — each
language page shows how.

Authenticate every client with an API key from **Settings → API Keys** — see
[Authentication & Scopes](../api-reference/authentication-and-scopes) for how
scopes work.
