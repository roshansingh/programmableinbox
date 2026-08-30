---
sidebar_position: 4
title: Webhooks
---

# Webhooks

ProgrammableInbox receives inbound mail via a webhook from
[Resend](https://resend.com) (`email.received` events), verified with an
HMAC signature and a 5-minute replay window.

## Sync vs. async ingestion

By default, ingestion happens inline on the webhook request: the message is
parsed, threaded, and stored before the response is sent. Setting
`ENABLE_ASYNC_WEBHOOK_PROCESSING=true` instead queues the job to a
Redis/BullMQ worker — useful for high-volume inboxes where inline processing
would make the webhook response too slow. Both paths run the same
threading, search-indexing, and automation logic; retries on the async path
are capped by `WEBHOOK_QUEUE_MAX_RETRIES` (default `3`).

## Threading

New messages are matched to an existing thread first by `In-Reply-To` /
`References` headers against a prior message's `Message-ID`, then by a
normalized subject match within the same inbox. This subject fallback
matters because mail providers don't always preserve the `Message-ID` a
recipient's client actually sees.

## Duplicates

A message that arrives twice (the same external id for the same inbox) is
silently skipped rather than stored twice.
