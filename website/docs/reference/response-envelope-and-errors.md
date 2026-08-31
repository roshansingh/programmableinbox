---
sidebar_position: 1
title: Response Envelope & Error Format
---

# Response Envelope & Error Format

Every API response is wrapped consistently, whether it succeeds or fails.

## Success

```json
{
  "data": { "...": "..." }
}
```

The actual resource or list is always under a top-level `data` key — never
returned bare.

## Error

```json
{
  "message": "A human-readable description of what went wrong"
}
```

Errors are distinguished by HTTP status code, not by a field in the body:

| Status | Meaning |
|---|---|
| `400` | Malformed request (bad input, failed validation) |
| `401` | Missing or invalid API key |
| `403` | The key's scopes don't cover this operation |
| `404` | The resource doesn't exist, or isn't visible to your organization |
| `409` | The request conflicts with existing state |
| `422` | The request is well-formed but violates a policy (e.g. the impersonation blocklist) |
| `429` | Rate limited — see [Rate Limits](rate-limits) |
| `503` | The deployment isn't configured to serve this request (e.g. no inbox domains configured) |
