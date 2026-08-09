# MCP server

`POST /api/mcp` exposes a read-mostly email surface over the
[Model Context Protocol](https://modelcontextprotocol.io), so an agent client (Claude Code,
Claude Desktop, Cursor, VS Code) can read inboxes and messages using an API key. Off unless
`ENABLE_MCP=true`; while off, the route 404s, so an instance that hasn't enabled it doesn't
advertise that it exists.

## Setup

**1. Enable it on the server**

```bash
# .env
ENABLE_MCP=true
```

Restart the server — config is parsed once per process, so a running instance won't pick this up
without a restart.

**2. Create an API key** in the dashboard (API Keys → Create) with the scopes the tools you want
need:

| Scope | Needed for |
|---|---|
| `email_inboxes:read` | listing inboxes |
| `email_messages:read` | listing, searching, reading messages, and OTP |
| `email_inboxes:create` | claiming new inbox addresses |
| `email_inboxes:update` | renaming inboxes |
| `email_inboxes:delete` | deleting inboxes |

The full `sk_live_…` key is shown once, at creation — copy it then. See
[multi-tenancy-and-api-keys.md](multi-tenancy-and-api-keys.md) for why these scopes are split
this finely, and grant `email_inboxes:delete` only where something genuinely needs it: deleting
retires the address permanently, with no restore path.

**3. Connect a client** at `https://<your-host>/api/mcp` (locally,
`http://localhost:4000/api/mcp`), with a standard bearer header.

Claude Code:

```bash
claude mcp add --transport http programmableinbox https://<your-host>/api/mcp \
  --header "Authorization: Bearer sk_live_..."
```

Cursor (`~/.cursor/mcp.json` or `.cursor/mcp.json`) and VS Code (`.vscode/mcp.json`) use the same
shape:

```json
{
  "mcpServers": {
    "programmableinbox": {
      "url": "https://<your-host>/api/mcp",
      "headers": { "Authorization": "Bearer ${env:PIBX_API_KEY}" }
    }
  }
}
```

Keep the key in an environment variable where the client supports it — these config files are
easy to commit by accident.

## In-process, not a proxy

Tool handlers call the same service layer the REST API does — `toOrgScope(principal)` into
`listMessages(scope, ...)`, exactly like `/api/v1`. MCP is **not** a thin shim that forwards the
caller's key to our own `/api/v1` endpoints. Building it that way would be the
[token-passthrough pattern](https://modelcontextprotocol.io/specification) the MCP security spec
forbids outright — "both ends are ours" isn't an exemption, and calling the service layer directly
avoids the pattern by construction rather than by policy.

## Nothing here can mutate — and that's a type-level fact

A mutating service takes an `OwnerScope`. `toOwnerScope` only accepts a `UserPrincipal`. The only
principal that ever reaches this route tree is an `ApiKeyPrincipal`. So the compiler refuses a
write regardless of what a prompt-injected message asks the model to do — see
[multi-tenancy-and-api-keys.md](multi-tenancy-and-api-keys.md) for how that scope split works.
That property is the whole reason it's defensible to let a model choose which tools to call.

## Tools

Six tools, all prefixed `pibx_email_`: `list_inboxes`, `list_messages`, `search_messages`,
`get_message`, `get_thread`, `get_latest_otp`.

- **`search_messages` is a separate tool from `list_messages`, with no `grouped` argument.** The
  underlying parser rejects `grouped=true` combined with any search parameter (see
  [email-ingestion-and-search.md](email-ingestion-and-search.md)); giving one tool both arguments
  would advertise a combination that's guaranteed to fail, and a model calling tools from a
  schema will eventually try it.
- **Schemas are plain JSON Schema**, not Zod — this repo is on `zod@3`, and the MCP SDK nests
  `zod@4`, so schema objects from one aren't reliably usable by the other. `fromJsonSchema`
  converts a JSON Schema into what the SDK needs for both advertising the tool and validating
  arguments.
- **Every read tool is annotated `readOnlyHint: true`.** The spec's defaults are
  `destructiveHint: true` and `openWorldHint: true`, so *omitting* the annotation would advertise
  a read as destructive, and clients gate confirmation prompts on it.
- **There is no delete tool**, deliberately, even though `email_inboxes:delete` exists as a scope.
  `DELETE /api/v1/emailInbox/{id}` exists for that. A REST client deletes because a developer
  wrote code that calls it; a tool call can be chosen by a model reading an attacker-controlled
  message body, and deleting an inbox is the one operation here nothing can undo.
- **`isError: true` vs. a JSON-RPC protocol error is a real distinction.** Anything a caller could
  fix by calling differently — missing scope, an inbox it can't see, a bad cursor, a search
  parameter over its cap — comes back as a tool result with a corrective message. Protocol-level
  JSON-RPC errors are reserved for an unknown tool name or a malformed request.
- **Response bodies default to snippets; full HTML is never returned, at any verbosity.** A single
  templated marketing email can be large enough to clear a client's tool-result token budget on
  its own. Full plain-text bodies come from `get_message` or `response_format: "detailed"`, and
  even those are capped, with a marker stating how much was dropped.

## Origin checking and rate limiting

`MCP_ALLOWED_ORIGINS` defends against DNS rebinding, as the transport spec requires: a request
with **no** `Origin` header is allowed (every supported client is a native or server-side caller
that sends none), while a request with an `Origin` not on the list is refused. Entries are
validated and canonicalized **at boot**, not at request time — a value that parses to something
that isn't a comparable origin (a bare host, `localhost:4000`, a non-special scheme like
`chrome-extension://`) fails `assertConfig()` by name rather than being silently dropped and then
refusing every request it was meant to admit.

Rate limiting reuses [the auth limiter](rate-limiting-and-account-security.md) under a separate
`mcp` scope, keyed on `apiKeyId` rather than IP — a credential this route already requires is a
more stable bucket than an address that might be shared behind a NAT.

## The envelope exception

The route returns the JSON-RPC envelope **verbatim** — the one deliberate exception to the
`jsonSuccess` convention described in [README.md](README.md#response-envelope). Wrapping it would
make the response unparseable to any MCP client, and `lib/api-client.ts` (which auto-unwraps
`data.data`) never calls this route anyway.
