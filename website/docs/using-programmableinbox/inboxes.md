---
sidebar_position: 1
title: Creating & Managing Inboxes
---

# Creating & Managing Inboxes

Create an inbox from the dashboard (**Inboxes → New Inbox**), the API
(`POST /api/v1/emailInbox`), an SDK, or an MCP client. Every inbox needs:

- A **local part** (the part before `@`), up to 50 characters.
- A **domain**, chosen from the deployment's configured
  `EMAIL_INBOX_DOMAINS` — you can't type an arbitrary domain.
- An optional **display name**, up to 100 characters.

## Guardrails on creation

Two checks run on every create and rename, so they can't be bypassed by
renaming an inbox after the fact:

- **Domain allowlist** — the address must be on a domain the deployment
  actually receives mail for.
- **Impersonation blocklist** — the local part and display name are checked
  against a list of terms associated with brand impersonation (normalizing
  lookalike spellings like `g00gle` or `g.o.o.g.l.e` first). A short or
  English-colliding term like `pi` or `chase` only blocks as a standalone
  word, so `pizza` and `purchase` are unaffected.

## Deleting an inbox

Deleting an inbox soft-deletes it and its messages — the data isn't
immediately destroyed. The address itself, however, is retired permanently
and cannot be recreated, so choose local parts you're comfortable losing
before you delete.

## Reading mail

Messages arrive via webhook in real time (or via an async queue for
high-volume inboxes) and appear in the dashboard, the API, and MCP
immediately. See [Search](search) for filtering, and
[Webhooks](webhooks) if you want to react to mail programmatically instead
of polling.
