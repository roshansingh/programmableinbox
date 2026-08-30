---
sidebar_position: 0
title: Authentication & Scopes
---

# Authentication & Scopes

Every request to `/api/v1/*` is authenticated with an API key, created from
the dashboard under **Settings → API Keys**. Send it as a bearer token:

```bash
curl https://app.programmableinbox.com/api/v1/emailInbox \
  -H "Authorization: Bearer sk_live_..."
```

The full key (`sk_live_...`) is shown exactly once, at creation time — store
it somewhere safe. ProgrammableInbox stores only a SHA-256 hash of it.

## Scopes

Each key is created with one or more scopes. A request fails with `403` if
the key's scopes don't cover the operation:

| Scope | Grants |
|---|---|
| `email_inboxes:read` | List and read email inboxes |
| `email_messages:read` | List, search, and read messages; read one-time codes |
| `email_inboxes:create` | Create new email inboxes |
| `email_inboxes:update` | Rename an existing email inbox |
| `email_inboxes:delete` | Delete an email inbox (soft-delete — the address itself is retired permanently and cannot be reused) |

`/api/v1` is **read-only except** for `POST /emailInbox` (needs
`email_inboxes:create`) and `PATCH`/`DELETE /emailInbox/{id}` (needs
`email_inboxes:update` / `email_inboxes:delete` respectively). Every other
endpoint only needs a `:read` scope.

## Response shape

Every successful response is wrapped as `{ "data": ... }`. Every error
response is `{ "message": "..." }` with a non-2xx status code.
