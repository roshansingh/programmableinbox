# ProgrammableInbox

**A secondary inbox built for developers.**

Spin up a programmable email address in seconds. ProgrammableInbox receives, categorizes, and
extracts every message — grab the OTP over an API, route mail with a rule, or read it in the UI.
Open source and self-hostable, so your mail never leaves your infrastructure.

It's also reachable from an [MCP](https://modelcontextprotocol.io) client like Claude Code or
Cursor, so an agent can read the same inbox you can.

Open source under [AGPL-3.0](LICENSE), with an optional commercial layer under [`ee/`](ee/).

## Features

- **Instant inboxes** on domains you control, with impersonation and length guards on creation
- **Real-time ingestion** via Resend webhooks, with an optional async (Redis/BullMQ) path for
  high-volume mail
- **Threading & full-text search** — subject/body search, tag and category filters, thread
  grouping
- **Automations** that run against incoming mail
- **Agent access via MCP** — list, search, and read inboxes and messages (including one-time
  codes) from Claude Code, Claude Desktop, Cursor, or VS Code, using an API key you already have
  ([setup](docs/architecture/mcp-server.md#setup))
- **A published REST API** (`/api/v1`) secured by scoped API keys, alongside the dashboard API
- **Multi-tenant by design** — organizations, memberships, and a read/write scope split enforced
  at the type level, not just in route handlers

## Quick start

### Docker (Community Edition)

No Node or local Postgres install needed — pulls the published image.

```bash
mkdir programmableinbox && cd programmableinbox
curl -fsSLO https://raw.githubusercontent.com/roshansingh/programmableinbox/main/docker-compose.yml
curl -fsSLO https://raw.githubusercontent.com/roshansingh/programmableinbox/main/.env.quickstart.example
cp .env.quickstart.example .env
# edit .env: set POSTGRES_PASSWORD, JWT_SECRET (openssl rand -base64 32), WEBHOOK_SECRET,
# AUTH_RESEND_API_KEY, and EMAIL_INBOX_DOMAINS — a placeholder is fine to start exploring

docker compose pull
docker compose up -d
# → http://localhost:4000, register a new account at /auth/register
```

See **[the Docker quickstart guide](https://docs.programmableinbox.com/introduction/quickstart-docker)**
for wiring up real inbound mail via Resend, upgrading, and troubleshooting.

### From source

**Requirements:** Node.js 24+, PostgreSQL 14+, and optionally Redis 6+ (only for async webhook
processing).

```bash
# Install dependencies
npm install

# Configure
cp .env.example .env
# fill in DATABASE_URL, JWT_SECRET, and the other required values — see .env.example

# Set up the database
npx prisma migrate dev
npx prisma db seed   # creates test@example.com / password123

# Run it
npm run dev
# → http://localhost:4000
```

Log in with `test@example.com` / `password123`, or register a new account.

## Documentation

- **[docs.programmableinbox.com](https://docs.programmableinbox.com)** — the public docs: product
  overview, self-hosting, the API reference, SDK usage, and MCP setup
- **[Architecture](docs/architecture/README.md)** — start here to understand how the app fits
  together: request flow, auth, multi-tenancy, email ingestion, search, the MCP server, and more,
  broken into one doc per topic
- **[Environment variables](.env.example)** — every variable, documented; validated at boot by
  `lib/config/` (see [configuration.md](docs/architecture/configuration.md))
- **[Client SDKs](sdk/README.md)** — generated Python, Go, TypeScript, Java, and C# clients for the
  v1 API
- **[Operator guide](docs/async-webhook-processing-operator-guide.md)** — running async webhook
  processing in production
- **[Logging](docs/logging.md)** — structured logging setup

## Commands

```bash
npm run dev          # Dev server on :4000 (Turbopack)
npm run build         # Production build
npm run start         # Run the production build
npm run lint          # ESLint
npm run test          # Run the test suite once
npm run test:watch    # Watch mode
npx prisma studio      # Browse the database
```

See [testing.md](docs/architecture/testing.md) for how the test suite is structured, including
the integration suite that runs against a real Postgres instance.

## License

The core of this repository is licensed under [AGPL-3.0](LICENSE). Code under [`ee/`](ee/), if
present, is licensed separately under [`ee/LICENSE`](ee/LICENSE) — see
[commercial-layer.md](docs/architecture/commercial-layer.md) for how the two fit together. A
build with `ee/` removed is a complete, fully functional open-source edition.

## Contributing

Issues and PRs are welcome. [`docs/architecture/README.md`](docs/architecture/README.md) is the
best starting point for understanding the codebase before making a change. Run `npm run test`
before opening a PR — the suite should stay green.
