---
sidebar_position: 1
title: Requirements
---

# Requirements

Most people are better off on the hosted version at
[app.programmableinbox.com](https://app.programmableinbox.com) — self-host
only if you specifically want your mail to stay on infrastructure you
control. ProgrammableInbox self-hosts via **Docker only**; there's no
supported from-source install path for running it in production. See
[Quickstart (Docker)](quickstart-docker) for the actual steps — this page
just covers what the machine needs.

## Minimum machine requirements

| Resource | Minimum | Recommended |
|---|---|---|
| CPU | 1 vCPU | 2 vCPU |
| Memory | 2 GB | 4 GB |
| Disk | 10 GB free | 20 GB+ free (grows with mail volume and Postgres/Redis data) |
| OS / architecture | Any Linux, macOS, or Windows host that runs Docker; images are multi-arch (`linux/amd64`, `linux/arm64`) | Linux server, for a long-running deployment |
| Network | Outbound internet (to pull images and reach the Resend API) | Also a public IP + domain name, if you want the instance to receive real mail |

These sizes cover the app, Postgres, and Redis running together in the same
Compose stack. They're a starting point, not a benchmark — a busy inbox with
heavy async webhook processing or a large searchable mail archive will want
more of all three.

## Software prerequisites

- **Docker Engine with the Compose plugin** — `docker compose version` should
  work. Docker Desktop covers this on macOS/Windows; most Linux distros need
  the Compose plugin installed alongside Docker Engine.

That's the only local install requirement — there's no Node.js, no Postgres,
and no build toolchain to set up yourself.

## External services

A [Resend](https://resend.com) account is **required** — self-hosted or not,
this product doesn't send or receive a single email without one. Before you
write your `.env`:

1. [Create a Resend account](https://resend.com) and add + verify the domain
   you want inboxes to live on — this becomes your
   `EMAIL_INBOX_ALLOWED_DOMAINS` value.
2. Create a webhook pointed at `https://<your-host>/api/webhooks/email` for
   the `email.received` event. This route is the only way mail reaches the
   app, so nothing arrives until it's set up.
3. While you're there, grab both credentials you'll need: your **API key**
   (`RESEND_API_KEY`) and the webhook's **signing secret**
   (`RESEND_WEBHOOK_SECRET`). Both go into `.env` — see
   [Quickstart (Docker) → Configure .env](quickstart-docker#configure-env).

A placeholder value for both lets the app boot and the UI load for a first
look, but you won't receive a real message until they're set to the values
above.

## Next step

Ready to run it? See [Quickstart (Docker)](quickstart-docker).
