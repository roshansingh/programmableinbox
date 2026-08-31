---
sidebar_position: 2
title: Search
---

# Search

Both the dashboard API and the public `/api/v1` API support the same four
query parameters on `GET /emailInbox/{id}/messages`:

| Parameter | Behavior |
|---|---|
| `q` | Full-text search over subject and body |
| `from` | Case-insensitive substring match on the sender address |
| `tags` | Exact match; multiple values are OR'd together |
| `categories` | Exact match; multiple values are OR'd together |

Multiple different parameters (e.g. `tags` **and** `categories`) are AND'd
together — a message must match every parameter supplied, but any one of
the OR'd values within a single parameter.

```bash
curl "https://app.programmableinbox.com/api/v1/emailInbox/{id}/messages?q=invoice&tags=billing" \
  -H "Authorization: Bearer sk_live_..."
```

## Search filters; it doesn't rank

Results stay ordered newest-first regardless of query relevance, and
pagination works identically with or without a search query.

## Grouped view and search don't combine

`grouped=true` (one row per thread) and any search parameter together
return a `400` — collapsing search hits into threads would either miscount
matches or return a thread whose latest message doesn't actually contain
the search term. Set `grouped=false` when searching.
