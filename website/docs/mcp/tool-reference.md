---
sidebar_position: 3
title: Tool Reference
---

# Tool Reference

All six tools are prefixed `pibx_email_`. Every tool call is scoped to the
organization your API key belongs to, exactly like the REST API.

| Tool | Does | Needs |
|---|---|---|
| `pibx_email_list_inboxes` | List inboxes in your organization | `email_inboxes:read` |
| `pibx_email_list_messages` | List messages in an inbox, optionally grouped into threads | `email_messages:read` |
| `pibx_email_search_messages` | Search messages by text, sender, tags, or categories | `email_messages:read` |
| `pibx_email_get_message` | Fetch one message in full | `email_messages:read` |
| `pibx_email_get_thread` | Fetch every message in a thread | `email_messages:read` |
| `pibx_email_get_latest_otp` | Fetch the most recent one-time code delivered to an inbox | `email_messages:read` |

`pibx_email_search_messages` has no `grouped` argument — grouping and
searching together isn't supported (see [Search](../using-programmableinbox/search)),
so the combination isn't offered as an option in the first place.

## Response size

By default, message bodies come back as short snippets rather than full
HTML, since a single templated marketing email can otherwise consume an
entire tool-call response budget on its own. Pass
`response_format: "detailed"` to `pibx_email_get_message` for the full body
when you actually need it — even then, an oversized body is capped with a
marker noting how much was cut, so a truncated body is never presented as if
it were complete.
