---
sidebar_position: 2
title: Setup
---

# Setup

## 1. Enable the MCP server

MCP is off by default. In your deployment's `.env`, set:

```
ENABLE_MCP=true
```

and restart the app. (See [Configuration](../self-hosting/configuration) for
the full list of related variables, including `MCP_ALLOWED_ORIGINS` if
you're connecting from a browser-based client.)

## 2. Create an API key

From the dashboard, under **Settings → API Keys**, create a key with the
scopes the tools you'll use need — typically `email_inboxes:read` and
`email_messages:read` at minimum. See
[Organizations & API Keys](../using-programmableinbox/organizations-and-api-keys)
for the full scope list.

## 3. Connect your client

The server is reachable at `/api/mcp` — e.g.
`http://localhost:4000/api/mcp` locally, or `https://your-domain.example.com/api/mcp`
in production.

**Claude Code:**

```bash
claude mcp add --transport http programmableinbox https://your-domain.example.com/api/mcp \
  --header "Authorization: Bearer sk_live_..."
```

**Cursor** (`.cursor/mcp.json`) or **VS Code** (`.vscode/mcp.json`):

```json
{
  "mcpServers": {
    "programmableinbox": {
      "url": "https://your-domain.example.com/api/mcp",
      "headers": {
        "Authorization": "Bearer ${env:PIBX_API_KEY}"
      }
    }
  }
}
```

Set the `PIBX_API_KEY` environment variable in your shell rather than
hardcoding the key into a file you might commit.
