---
sidebar_position: 2
title: Rate Limits
---

# Rate Limits

Rate limiting applies to the dashboard's login and registration endpoints
(`/api/app/auth/login`, `/api/app/auth/register`), not to the `/api/v1` API
key surface.

## Defaults

| Limit | Value |
|---|---|
| Login, per IP | 20 requests / 5 minutes |
| Login, per account | 10 requests / 15 minutes |
| Registration, per IP | 10 requests / hour |
| Registration, per address | 5 requests / hour |
| Account lockout | After 5 consecutive failed logins, starting at 1 minute and doubling up to a 15-minute cap |

Every throttled response returns the same message regardless of whether the
account exists, so a `429` never reveals account existence.

All of these are configurable per deployment — see the operator's
`.env.example` for the exact variable names if you need to change them.

## Behavior when the rate limiter is unreachable

Self-hosted deployments using Redis-backed rate limiting fail **open** by
default: if Redis is unreachable, requests are allowed through rather than
blocked, so a Redis outage doesn't also become a login outage. This can be
changed to fail closed per deployment.
