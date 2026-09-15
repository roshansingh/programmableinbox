---
sidebar_position: 1
title: Setup
---

# MCP Setup

[MCP](https://modelcontextprotocol.io) lets an agent — Claude Code, Codex, or
GitHub Copilot — read your ProgrammableInbox inboxes directly, using the same
API key you'd use to call the REST API. Handy for testing: an agent building
or verifying a signup flow can pull a one-time code from an inbox itself,
instead of you copy-pasting it mid-conversation.

Everything exposed over MCP is **read-only except for creating and updating
inboxes** — there is no delete tool, by design, since a tool call can be
triggered by a model reading attacker-controlled text, not just a person
deliberately clicking a button. See [Tool Reference](tool-reference) for what
each tool does.

## 1. Create an API key

From the dashboard, under **Settings → API Keys**, create a key with the
scopes the tools you'll use need — typically `email_inboxes:read` and
`email_messages:read` at minimum. The two write tools need their own scopes
too: `pibx_email_create_inbox` needs `email_inboxes:create` and
`pibx_email_update_inbox` needs `email_inboxes:update` — a key minted with
only the two read scopes can't invoke them. See
[Organizations & API Keys](../using-programmableinbox/organizations-and-api-keys)
for the full scope list.

## 2. Enable MCP {#self-hosted}

On the hosted cloud instance at
[app.programmableinbox.com](https://app.programmableinbox.com), MCP is
already enabled — skip to step 3.

**On a self-hosted deployment, MCP is off by default.** In your `.env`, set:

```
MCP_ENABLED=true
```

and restart the app (`docker compose up -d` after editing `.env` — see
[Quickstart (Docker)](../self-hosting/quickstart-docker) if you haven't set
up the stack yet). See [Configuration](../self-hosting/configuration) for the
full list of related variables, including `MCP_ALLOWED_ORIGINS` if you're
connecting from a browser-based client.

The server is reachable at `/api/mcp` on your own domain — e.g.
`http://localhost:4000/api/mcp` locally, or `https://your-domain.example.com/api/mcp`
in production. Use that URL in place of
`https://app.programmableinbox.com` in the client examples below.

## 3. Connect your client

Set the `PIBX_API_KEY` environment variable in your shell first, rather than
hardcoding the key into a file you might commit — every example below reads
from it.

### Claude Code

```bash
claude mcp add --transport http programmableinbox https://app.programmableinbox.com/api/mcp \
  --header "Authorization: Bearer ${PIBX_API_KEY}"
```

### Codex

Codex CLI doesn't have an `mcp add` command for HTTP servers — add the server
directly to `~/.codex/config.toml` (or `.codex/config.toml` in a project):

```toml
[mcp_servers.programmableinbox]
url = "https://app.programmableinbox.com/api/mcp"
bearer_token_env_var = "PIBX_API_KEY"
```

`bearer_token_env_var` tells Codex to read the token from your environment at
runtime, so the key itself never lands in `config.toml`.

### GitHub Copilot

```bash
copilot mcp add --transport http \
  --header "Authorization: Bearer ${PIBX_API_KEY}" \
  programmableinbox https://app.programmableinbox.com/api/mcp
```

Or edit `~/.copilot/mcp-config.json` directly:

```json
{
  "mcpServers": {
    "programmableinbox": {
      "type": "http",
      "url": "https://app.programmableinbox.com/api/mcp",
      "headers": {
        "Authorization": "Bearer ${PIBX_API_KEY}"
      }
    }
  }
}
```
