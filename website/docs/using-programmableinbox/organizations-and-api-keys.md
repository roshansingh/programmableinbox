---
sidebar_position: 5
title: Organizations & API Keys
---

# Organizations & API Keys

Every inbox, message, and API key belongs to exactly one **organization**.
A user's memberships determine which organizations' data they can see in
the dashboard.

## Seeing vs. changing

Any member of an organization can see every inbox that belongs to it. Only
the inbox's creator (or an organization admin) can rename, delete it, or
send mail from it. The dashboard reflects this directly — an inbox you
don't own shows without the actions you can't take on it, rather than
letting you click into a action that then fails.

## API keys

An API key is created from the dashboard (**Settings → API Keys**), bound
to one organization, and scoped to a subset of operations. The full key is
shown exactly once, at creation — copy it immediately, since only its
12-character prefix and a hash are stored afterward and it can't be
retrieved again.

See [Authentication & Scopes](../api-reference/authentication-and-scopes)
for the full list of scopes and what each grants. A key can never see or
act on a different organization's data, regardless of its scopes.
