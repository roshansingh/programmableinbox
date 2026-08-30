---
sidebar_position: 3
title: Automations
---

# Automations

An automation is a rule, configured per organization, that runs against
each incoming message as it's ingested — for example, forwarding messages
matching a condition to an external webhook. Configure automations from the
dashboard under **Automations**.

Automations run on both the synchronous and asynchronous ingestion paths, so
behavior doesn't change based on whether `ENABLE_ASYNC_WEBHOOK_PROCESSING`
is on for a given deployment.
