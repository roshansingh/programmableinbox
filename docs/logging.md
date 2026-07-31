# Logging Guide

## Overview

This app uses [Pino v10](https://getpino.io/) for structured logging. Every log line is a JSON object (in production) or a colorized human-readable line (in development), rather than a plain string. This makes logs machine-parseable for aggregation tools (Datadog, Logtail, CloudWatch, etc.) while staying readable during local development.

**When to use logging vs other tools:**

- **Logger** — operational events in request handlers: errors, significant user actions, unexpected-but-recoverable conditions.
- **`console.log`** — never in application code; reserved for build scripts or one-off debugging that gets removed before merging.
- **Error tracking (e.g. Sentry)** — for alerting on unhandled exceptions; complements logging but is not a replacement.
- **Metrics** — for aggregate counts/latencies. Logs can feed metrics pipelines, but don't use logs as your only performance signal.

---

## Setup

### Importing the logger

```ts
import logger from '@/lib/logger'
```

The default export is a factory function. Call it to get the Pino `Logger` instance:

```ts
logger().info('Server started')
```

The instance is a singleton — repeated calls to `logger()` return the same object, so there is no overhead from calling it at the top of a function.

You can also import the named export if you prefer explicit naming:

```ts
import { getLogger } from '@/lib/logger'

getLogger().info('Server started')
```

### Basic log levels

```ts
import logger from '@/lib/logger'

// Informational: normal operation worth recording
logger().info({ userId, action: 'login' }, 'User logged in')

// Warning: unexpected condition that was handled; system continues normally
logger().warn({ attemptedPath }, 'Unrecognized route hit by client')

// Error: something failed; action could not be completed
logger().error({ error, requestId }, 'Database write failed')
```

---

## Structured logging best practices

### Always pass a context object as the first argument

Pino's logging methods accept an optional object as the first argument. Put all variable data there — never interpolate values into the message string.

```ts
// Good
logger().info({ userId, inboxId }, 'User accessed inbox')

// Bad — values are lost in plain text; cannot filter by userId
console.log('User ' + userId + ' accessed inbox ' + inboxId)

// Also bad — template literal still produces an unstructured string
logger().info(`User ${userId} accessed inbox ${inboxId}`)
```

The message string should be a static, human-readable label. The context object carries the dynamic data. This lets log aggregators index `userId` as a searchable field rather than burying it in a string.

### Error objects

Pass Error instances under the `error` key. Pino's built-in error serializer extracts `message`, `stack`, and `type`:

```ts
try {
  await prisma.apiKey.create(data)
} catch (error) {
  logger().error({ error }, 'Error creating API key')
  return jsonError('Internal server error', 500)
}
```

### What context to include

Include IDs and metadata that would help you answer "what happened and for whom?":

- Resource IDs: `userId`, `inboxId`, `threadId`, `emailId`
- Request metadata: `requestId`, `svixId` (for webhooks)
- Outcome data: `resendId`, `jobCount`
- The `error` object on failures

Avoid logging sensitive values: passwords, full API keys, personal email bodies.

---

## Environment configuration

### `LOG_LEVEL` environment variable

Set `LOG_LEVEL` in `.env` to control which messages appear. Valid values (from most to least verbose):

| Level    | Meaning                                              |
|----------|------------------------------------------------------|
| `trace`  | Very low-level internals; use only for deep debugging |
| `debug`  | Developer-facing diagnostic detail                   |
| `info`   | Normal operations worth recording (default in prod)  |
| `warn`   | Unexpected but recoverable conditions                |
| `error`  | Failures that prevented an action from completing    |
| `fatal`  | Application-level failures causing shutdown          |
| `silent` | Suppresses all output (useful in test pipelines)     |

Values are case-sensitive and must be lowercase. `LOG_LEVEL=INFO` is not valid and will fall back to the default with a warning.

If `LOG_LEVEL` is unset or contains an invalid value, the logger falls back to `debug` in development and `info` in production and prints a warning to stderr.

### Development vs production output

**Development** (`NODE_ENV !== 'production'`): uses `pino-pretty` for colorized, human-readable output with timestamps in local time. `pid` and `hostname` are suppressed.

**Production** (`NODE_ENV=production`): plain JSON to stdout, one object per line. This is the standard format for log aggregation pipelines.

You do not need to configure anything to get this behavior — it is automatic based on `NODE_ENV`.

---

## Examples from existing routes

### API key creation error

`app/api/v1/apiKeys/route.ts`

```ts
import logger from '@/lib/logger'

try {
  const key = await prisma.apiKey.create({ data })
  return jsonSuccess(key, 201)
} catch (error) {
  logger().error({ error }, 'Error creating API key')
  return jsonError('Internal server error', 500)
}
```

### Webhook signature validation failure

`app/api/webhooks/email/route.ts`

```ts
import logger from '@/lib/logger'

try {
  resend.webhooks.verify({
    payload: rawBody,
    headers: {
      id: request.headers.get('svix-id')!,
      timestamp: request.headers.get('svix-timestamp')!,
      signature: request.headers.get('svix-signature')!,
    },
    webhookSecret: process.env.WEBHOOK_SECRET!,
  })
} catch (error) {
  logger().warn({
    error,
    svixId: request.headers.get('svix-id'),
    svixTimestamp: request.headers.get('svix-timestamp'),
  }, 'Invalid webhook signature')
  return NextResponse.json({ message: 'Invalid webhook signature' }, { status: 401 })
}
```

This uses `warn` rather than `error` because the system handled the condition gracefully (rejected the request). An `error` would imply something broke unexpectedly.

### Email sent successfully

`app/api/v1/emailInbox/[id]/send/route.ts`

```ts
import logger from '@/lib/logger'

logger().info({ inboxId: id, resendId, threadId }, 'Email sent successfully')
```

---

## Common patterns

### Severity level guidelines

| Situation                                              | Level   |
|--------------------------------------------------------|---------|
| User action completed normally (login, send, create)   | `info`  |
| Resource not found (no matching inbox, unknown ID)     | `warn`  |
| Invalid input caught and rejected (bad signature, etc) | `warn`  |
| External service call failed (Resend error, DB write)  | `error` |
| Unexpected exception in catch block                    | `error` |
| Worker or background process crashed                   | `error` |

### Child loggers for components

If you are building a subsystem (e.g. a background worker), create a child logger with a fixed `component` field rather than repeating it on every call:

```ts
const log = logger().child({ component: 'email-webhook-worker' })

log.info({ jobId }, 'Processing job')
log.error({ jobId, error }, 'Job failed')
```

All log lines from this component will carry `"component": "email-webhook-worker"` automatically.

### Adding a new endpoint — quick checklist

1. Import: `import logger from '@/lib/logger'`
2. Wrap database/external calls in try/catch.
3. On catch: `logger().error({ error, ...relevantIds }, 'Descriptive failure message')`
4. On success (if the operation is worth tracking): `logger().info({ ...relevantIds }, 'Action completed')`
5. Keep message strings static; put all variable data in the context object.

---

## Testing

The logger does not need to be mocked in tests. Pino writes to stdout by default; in the test environment this output is suppressed by the test runner unless a test fails, at which point it appears in the failure output.

Tests call production code that internally calls `logger()` and nothing breaks — the logger is a real singleton that simply emits to stdout.

If you need to assert that a particular log line was emitted (rare), capture stdout or use a Pino destination stream in the test setup. In most cases, verifying the response status and body is sufficient.
