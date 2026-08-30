---
sidebar_position: 2
title: Core Concepts
---

# Core Concepts

## Email inboxes

An **email inbox** is an address you provision on a domain the deployment
controls (`EMAIL_INBOX_DOMAINS`) — e.g. `qa@inbox.example.com`. Creating one
through the dashboard, API, or MCP reserves the address; mail sent to it is
received via webhook, stored, and made available for reading, search, and
automations. Deleting an inbox soft-deletes its messages, but the address
itself is retired permanently and cannot be recreated.

## Threading

Incoming messages are grouped into threads first by matching `In-Reply-To` /
`References` headers against a prior message's `Message-ID`, and falling
back to a normalized subject match (stripping `Re:`/`Fwd:` prefixes) within
the same inbox. A message that matches nothing starts a new thread using its
own id as the thread id.

## Search

Messages are searchable by full text (subject and body), sender (substring
match), tags, and categories — the same query parameters work whether you're
calling the dashboard API or the public `/api/v1` API. Search filters
results; it does not change their order, so pagination keeps working
identically with or without a search query applied.

## Automations

An automation runs against incoming mail — for example, forwarding messages
matching a condition to a webhook. Automations are configured per
organization and evaluated as each message is ingested.

## Organizations, memberships, and API keys

Every inbox, message, and API key belongs to an **organization**. A user
reaches an organization's data through a **membership** — which organizations
they belong to determines what they can see. An **API key** is bound to a
single organization and can be scoped to a subset of operations (see
[Authentication & Scopes](../api-reference/authentication-and-scopes)) — it
can never see or act on a different organization's data.

## Ownership vs. visibility

Within an organization, every member can see every inbox. Only the user who
created an inbox can rename, delete it, or send mail from it — seeing
something and being allowed to change it are deliberately different
permissions.
