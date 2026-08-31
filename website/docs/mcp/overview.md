---
sidebar_position: 1
title: Overview
---

# MCP

[MCP](https://modelcontextprotocol.io) (Model Context Protocol) lets an
agent — Claude Code, Claude Desktop, Cursor, or VS Code — read your
ProgrammableInbox inboxes directly, using the same API key you'd use to
call the REST API.

This is useful for testing: an agent building or testing a signup flow can
retrieve a one-time code from an inbox itself, instead of you copy-pasting
it from a dashboard mid-conversation.

Everything exposed over MCP is **read-only except for creating and updating
inboxes** — there is no delete tool, by design, since a tool call can be
triggered by a model reading attacker-controlled text, not just a person
deliberately clicking a button.

See [Setup](setup) to connect a client, and [Tool Reference](tool-reference)
for what each tool does.
