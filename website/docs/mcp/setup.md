---
sidebar_position: 2
title: Setup
---

# Setup

## 1. Create an API key

From the dashboard, under **Settings → API Keys**, create a key with the
scopes the tools you'll use need — typically `email_inboxes:read` and
`email_messages:read` at minimum. The two write tools need their own scopes
too: `pibx_email_create_inbox` needs `email_inboxes:create` and
`pibx_email_update_inbox` needs `email_inboxes:update` — a key minted with
only the two read scopes can't invoke them. See
[Organizations & API Keys](../using-programmableinbox/organizations-and-api-keys)
for the full scope list.

## 2. Connect your client

Pick the example that matches your setup — the hosted cloud instance, or your
own self-hosted deployment.

### Cloud (app.programmableinbox.com)

MCP is already enabled on the hosted instance, so this is just the API key
from Step 1 plus your client config.

**Claude Code:**

```bash
claude mcp add --transport http programmableinbox https://app.programmableinbox.com/api/mcp \
  --header "Authorization: Bearer sk_live_..."
```

**Cursor** (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "programmableinbox": {
      "url": "https://app.programmableinbox.com/api/mcp",
      "headers": {
        "Authorization": "Bearer ${env:PIBX_API_KEY}"
      }
    }
  }
}
```

**VS Code** (`.vscode/mcp.json`):

```json
{
  "servers": {
    "programmableinbox": {
      "url": "https://app.programmableinbox.com/api/mcp",
      "headers": {
        "Authorization": "Bearer ${env:PIBX_API_KEY}"
      }
    }
  }
}
```

### Self-hosted

MCP is off by default on a self-hosted deployment. In your `.env`, set:

```
ENABLE_MCP=true
```

and restart the app. (See [Configuration](../self-hosting/configuration) for
the full list of related variables, including `MCP_ALLOWED_ORIGINS` if
you're connecting from a browser-based client.)

The server is reachable at `/api/mcp` on your own domain — e.g.
`http://localhost:4000/api/mcp` locally, or `https://your-domain.example.com/api/mcp`
in production. Replace the URL in the examples below with yours.

**Claude Code:**

```bash
claude mcp add --transport http programmableinbox https://your-domain.example.com/api/mcp \
  --header "Authorization: Bearer sk_live_..."
```

**Cursor** (`.cursor/mcp.json`):

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

**VS Code** (`.vscode/mcp.json`):

```json
{
  "servers": {
    "programmableinbox": {
      "url": "https://your-domain.example.com/api/mcp",
      "headers": {
        "Authorization": "Bearer ${env:PIBX_API_KEY}"
      }
    }
  }
}
```

Either way, set the `PIBX_API_KEY` environment variable in your shell rather
than hardcoding the key into a file you might commit.
