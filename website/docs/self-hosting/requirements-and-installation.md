---
sidebar_position: 1
title: Requirements & Installation
---

# Requirements & Installation

Running from source gives you seeded test data and hot reload — better for
evaluating the project or developing against it. For a production
deployment, see [Production Deployment](production-deployment); for the
fastest way to try it with zero local toolchain setup, see the
[Docker quickstart](../introduction/quickstart-docker).

## Requirements

- Node.js 24+
- PostgreSQL 14+
- Redis 6+ (optional — only needed for async webhook processing or auth rate
  limiting; see [Configuration](configuration))

## Install

```bash
git clone https://github.com/roshansingh/programmableinbox.git
cd programmableinbox
npm install
cp .env.example .env
```

Fill in `.env` — see [Configuration](configuration) for what's required.

```bash
npx prisma migrate dev
npx prisma db seed   # creates test@example.com / password123
npm run dev
```

The app is now running at [http://localhost:4000](http://localhost:4000).
Log in with `test@example.com` / `password123`, or register a new account.
