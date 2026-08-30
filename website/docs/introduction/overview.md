---
slug: /
sidebar_position: 1
title: Overview
---

# ProgrammableInbox

**A secondary inbox built for developers.**

Spin up a programmable email address in seconds. ProgrammableInbox receives,
categorizes, and extracts every message — grab a one-time code over the API,
route mail with an automation, or read it in the dashboard.

It's open source and self-hostable, so your mail never has to leave your own
infrastructure. It's also reachable from an [MCP](https://modelcontextprotocol.io)
client like Claude Code or Cursor, so an agent can read the same inbox you can.

## What it's for

- **Testing and QA** — disposable inboxes for signup flows, magic links, and
  one-time codes, without a shared team mailbox.
- **Agent workflows** — give an LLM agent a real, addressable inbox it can
  read via MCP or the SDKs, instead of screen-scraping a mail client.
- **Programmatic mail handling** — receive, thread, search, and act on
  incoming mail through a [REST API](../api-reference/authentication-and-scopes),
  with automations for routing.

## Features

- **Instant inboxes** on domains you control, with impersonation and length
  guards on creation.
- **Real-time ingestion** via Resend webhooks, with an optional async
  (Redis/BullMQ) path for high-volume mail.
- **Threading & full-text search** — subject/body search, tag and category
  filters, thread grouping.
- **Automations** that run against incoming mail.
- **Agent access via MCP** — list, search, and read inboxes and messages
  (including one-time codes) from an MCP-compatible client using an API key
  you already have.
- **A published REST API** (`/api/v1`) secured by scoped API keys.
- **Multi-tenant by design** — organizations, memberships, and a read/write
  scope split.

## Where to start

- New to the project? Start at [Authentication & Scopes](../api-reference/authentication-and-scopes).
- Calling the API? Start at [Authentication & Scopes](../api-reference/authentication-and-scopes).
- Want to learn more? Check out the full [API Reference](../api-reference/authentication-and-scopes).

Open source under [AGPL-3.0](https://github.com/roshansingh/programmableinbox/blob/main/LICENSE),
with an optional commercial layer.
