# 001 — Email Automations

**Status:** DRAFT — updated for config-first architecture
**Owner:** unassigned
**Created:** 2026-05-04
**Updated:** 2026-05-06

## TL;DR

Add a configuration-driven email automations system where the canonical artifact is a **versioned typed automation config**, not a React Flow document. Each configuration object must declare both a `type` and a `version`. Conditions such as `subject contains`, `body contains`, and `from`, plus actions such as `webhook` and `email`, are stored as typed config nodes. The backend validates and executes that config, and the UI compiles it into a React Flow graph for editing and visualization.

This ticket also keeps a hard prerequisite explicit: there is no outbound webhook delivery worker today, so shipping the `send_webhook` action either requires building that worker here or deferring that action behind a feature flag.

## 1. Why

InboxUI gives developers a programmable inbound email address but still lacks a first-class way to react to mail. Today the user experience is "receive, store, poll." That is below the baseline set by Gmail filters, Mailgun routes, Front rules, Help Scout workflows, Zapier email triggers, and n8n.

The important architectural constraint for InboxUI is that the system cannot be "React Flow JSON all the way down." Visual wiring libraries are editor tools, not stable business contracts. The source of truth must be:

- Typed enough to validate on the server.
- Versioned enough to migrate safely over time.
- Stable enough to replay old runs against the exact configuration that executed originally.
- Flexible enough to render as a graph in React Flow.

That leads to a configuration-first design:

- Canonical executable config: versioned JSON document with typed nodes and edges.
- Immutable revisions: every save produces a new revision.
- Derived React Flow graph: generated from canonical config plus persisted layout metadata.
- Runtime logs: relational rows tied to the exact revision that ran.

## 2. User stories

1. **As an org owner**, I create a rule "if subject contains `[support]`, forward to `support@acme.com` and POST to `https://acme.com/hooks/support`."
2. **As a developer**, I create a rule "if `from` matches `*@trusted.com`, send a webhook with the parsed email as JSON."
3. **As a support lead**, I create an auto-reply for messages received outside business hours.
4. **As any user**, I open a visual editor, inspect a trigger → condition → action flow in React Flow, and save it without writing code.
5. **As any user**, I run an automation against the last 50 historical messages in dry-run mode before enabling it.
6. **As any user**, I inspect a run log that shows which config nodes evaluated, which branch was taken, and what each action returned.
7. **As a maintainer**, I can evolve the config schema from v1 to v2 without breaking existing automations or old run replays.

## 3. Scope

### In (v1)

- One trigger type: `email.received`.
- Typed condition configs for:
  - `from`
  - `to`
  - `cc`
  - `subject`
  - `body_text`
  - `header`
  - `has_attachment`
- Operators:
  - `equals`
  - `contains`
  - `starts_with`
  - `ends_with`
  - `regex`
  - `exists`
- Boolean condition grouping with `all` / `any`.
- Four action types:
  - `forward_email`
  - `send_webhook`
  - `auto_reply`
  - `add_tag`
- Immutable automation revisions with a versioned JSON config payload.
- React Flow editor that renders the automation as a graph and persists layout separately from executable config.
- Per-rule on/off toggle, ordered priority, and stop/continue behavior.
- Dry-run execution against historical messages.
- Per-run audit log tied to the exact automation revision executed.
- Loop guards, auto-reply throttling, and action/run caps.

### Explicitly out (deferred)

- Triggers other than `email.received`.
- LLM actions.
- Slack / Discord / Teams native actions.
- Delay / wait / scheduler nodes.
- Arbitrary user-authored DAG semantics such as `merge`, `switch`, or general fan-out/fan-in.
- A raw JSON or scripting mode in the v1 editor.
- Mobile editor.
- A durable job queue. v1 may dispatch in-process and document that limitation.

### Hard prerequisites

- **Outbound webhook delivery worker.** `WebhookEvent` exists today, but there is no outbound delivery worker wired to execute queued webhook deliveries.
- **Attachment metadata capture.** `has_attachment` requires message-level attachment metadata at ingest time.

## 4. Design decision

The system must be **configuration-driven first**.

That means:

- The backend does **not** execute React Flow node state directly.
- The database does **not** store only a canvas-shaped graph as the source of truth.
- Runtime semantics do **not** emerge from arbitrary edge wiring.

Instead:

- The canonical object is `AutomationConfig`.
- Every config object declares a `type` and `version`.
- Every save creates an immutable `AutomationRevision`.
- The executor consumes validated config from that revision.
- React Flow renders a derived graph from config plus layout metadata.

This is the best implementation for InboxUI because v1 semantics are intentionally constrained. We know the allowed triggers, the condition surface is form-driven, and the action catalog is finite. A typed DSL is easier to validate, migrate, diff, test, and replay than either raw React Flow JSON or a generic expression language exposed directly as storage.

## 5. Data model

New Prisma models should separate:

- identity and tenancy
- immutable config revisions
- runtime logs
- message-side relational data

### 5.1 Prisma shape

```prisma
model Automation {
  id                String   @id @default(cuid())
  organizationId    String
  inboxId           String?
  name              String
  description       String?
  isActive          Boolean  @default(true)
  activeRevisionId  String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  organization      Organization        @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  inbox             EmailInbox?         @relation(fields: [inboxId], references: [id], onDelete: Cascade)
  activeRevision    AutomationRevision? @relation("AutomationActiveRevision", fields: [activeRevisionId], references: [id], onDelete: SetNull)
  revisions         AutomationRevision[] @relation("AutomationRevisions")
  runs              AutomationRun[]

  @@index([organizationId])
  @@index([inboxId])
  @@map("automations")
}

model AutomationRevision {
  id               String   @id @default(cuid())
  automationId     String
  revision         Int
  schemaVersion    Int
  config           Json
  layout           Json?
  createdByUserId  String?
  createdAt        DateTime @default(now())

  automation       Automation   @relation("AutomationRevisions", fields: [automationId], references: [id], onDelete: Cascade)
  activeFor        Automation[] @relation("AutomationActiveRevision")

  @@unique([automationId, revision])
  @@index([automationId])
  @@map("automation_revisions")
}

enum AutomationRunStatus {
  queued
  running
  succeeded
  failed
  partial
  skipped
}

model AutomationRun {
  id                    String              @id @default(cuid())
  automationId          String
  automationRevisionId  String
  organizationId        String
  emailMessageId        String?
  triggerType           String
  status                AutomationRunStatus
  isDryRun              Boolean             @default(false)
  inputSnapshot         Json
  error                 Json?
  startedAt             DateTime            @default(now())
  finishedAt            DateTime?

  automation            Automation          @relation(fields: [automationId], references: [id], onDelete: Cascade)
  automationRevision    AutomationRevision  @relation(fields: [automationRevisionId], references: [id], onDelete: Cascade)
  organization          Organization        @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  emailMessage          EmailMessage?       @relation(fields: [emailMessageId], references: [id], onDelete: SetNull)
  nodeRuns              AutomationNodeRun[]

  @@index([automationId])
  @@index([automationRevisionId])
  @@index([organizationId])
  @@index([emailMessageId])
  @@map("automation_runs")
}

model AutomationNodeRun {
  id              String              @id @default(cuid())
  runId           String
  configNodeId    String
  configNodeType  String
  status          AutomationRunStatus
  branchTaken     String?
  input           Json?
  output          Json?
  error           Json?
  startedAt       DateTime            @default(now())
  finishedAt      DateTime?

  run             AutomationRun       @relation(fields: [runId], references: [id], onDelete: Cascade)

  @@index([runId])
  @@map("automation_node_runs")
}

model EmailAttachment {
  id              String       @id @default(cuid())
  emailMessageId  String
  filename        String
  contentType     String?
  sizeBytes       Int?
  createdAt       DateTime     @default(now())

  emailMessage    EmailMessage @relation(fields: [emailMessageId], references: [id], onDelete: Cascade)

  @@index([emailMessageId])
  @@map("email_attachments")
}
```

### 5.2 Why this split

- `Automation` stays thin and queryable.
- `AutomationRevision` stores the immutable versioned config document that actually ran.
- `AutomationRun` references both `automationId` and `automationRevisionId`, so replay is precise after later edits.
- `EmailAttachment` stays relational because attachment metadata is message data, not config.

## 6. Configuration contract

Every configuration object in the automation DSL must declare:

- `type`
- `version`

This is mandatory for:

- top-level automation config
- trigger configs
- condition configs
- action configs
- layout config

### 6.1 Top-level config

```ts
type AutomationConfigV1 = {
  type: 'email_automation'
  version: 1
  settings: {
    priority: number
    stopPolicy: 'continue' | 'stop_after_match'
    maxActionsPerRun?: number
    maxBranchDepth?: number
  }
  trigger: TriggerConfigV1
  nodes: AutomationNodeConfigV1[]
  edges: AutomationEdgeConfigV1[]
}

type AutomationLayoutV1 = {
  type: 'react_flow_layout'
  version: 1
  positions: Record<string, { x: number; y: number }>
  viewport?: { x: number; y: number; zoom: number }
}
```

### 6.2 Node config shape

```ts
type AutomationNodeConfigV1 =
  | TriggerNodeConfigV1
  | ConditionNodeConfigV1
  | ActionNodeConfigV1

type TriggerNodeConfigV1 = {
  id: string
  type: 'trigger'
  version: 1
  triggerType: 'email.received'
  config: EmailReceivedTriggerConfigV1
}

type ConditionNodeConfigV1 = {
  id: string
  type: 'condition'
  version: 1
  conditionType: 'predicate_group'
  config: ConditionExprV1
}

type ActionNodeConfigV1 =
  | {
      id: string
      type: 'action'
      version: 1
      actionType: 'forward_email'
      onError?: 'stop' | 'continue'
      config: ForwardEmailActionConfigV1
    }
  | {
      id: string
      type: 'action'
      version: 1
      actionType: 'send_webhook'
      onError?: 'stop' | 'continue'
      config: SendWebhookActionConfigV1
    }
  | {
      id: string
      type: 'action'
      version: 1
      actionType: 'auto_reply'
      onError?: 'stop' | 'continue'
      config: AutoReplyActionConfigV1
    }
  | {
      id: string
      type: 'action'
      version: 1
      actionType: 'add_tag'
      onError?: 'stop' | 'continue'
      config: AddTagActionConfigV1
    }

type AutomationEdgeConfigV1 = {
  id: string
  type: 'edge'
  version: 1
  sourceNodeId: string
  sourcePort?: 'matched' | 'unmatched' | 'next'
  targetNodeId: string
}
```

### 6.3 Trigger config

```ts
type EmailReceivedTriggerConfigV1 = {
  type: 'email.received'
  version: 1
}
```

### 6.4 Condition config

Use a **typed AST**, not raw JSONLogic, as the persistence contract.

Why:

- The allowed fields/operators are narrow and stable.
- The editor is form-driven.
- Validation is much easier with discriminated unions.
- Audit logs can reference normalized predicate nodes directly.
- We avoid building a second translation layer from forms into a generic expression language that still needs custom operators.

```ts
type ConditionExprV1 =
  | {
      type: 'group'
      version: 1
      operator: 'all' | 'any'
      children: ConditionExprV1[]
    }
  | {
      type: 'predicate'
      version: 1
      field:
        | 'email.from'
        | 'email.to'
        | 'email.cc'
        | 'email.subject'
        | 'email.body_text'
        | 'email.has_attachment'
      operator: 'equals' | 'contains' | 'starts_with' | 'ends_with' | 'regex' | 'exists'
      value?: string | string[] | boolean
    }
  | {
      type: 'header_predicate'
      version: 1
      headerName: string
      operator: 'equals' | 'contains' | 'regex' | 'exists'
      value?: string
    }
```

Examples:

```json
{
  "type": "group",
  "version": 1,
  "operator": "all",
  "children": [
    {
      "type": "predicate",
      "version": 1,
      "field": "email.subject",
      "operator": "contains",
      "value": "[support]"
    },
    {
      "type": "predicate",
      "version": 1,
      "field": "email.from",
      "operator": "regex",
      "value": ".*@acme\\.com$"
    }
  ]
}
```

```json
{
  "type": "header_predicate",
  "version": 1,
  "headerName": "x-priority",
  "operator": "equals",
  "value": "high"
}
```

### 6.5 Action config

```ts
type ForwardEmailActionConfigV1 = {
  type: 'forward_email'
  version: 1
  to: string[]
  cc?: string[]
  bcc?: string[]
  includeAttachments?: boolean
  prependNote?: string
}

type SendWebhookActionConfigV1 = {
  type: 'send_webhook'
  version: 1
  url: string
  method?: 'POST' | 'PUT'
  headers?: Record<string, string>
  bodyTemplate?: string
  secret?: string
}

type AutoReplyActionConfigV1 = {
  type: 'auto_reply'
  version: 1
  subjectTemplate: string
  bodyTemplate: string
  fromName?: string
  oncePerSenderWindowHours?: number
}

type AddTagActionConfigV1 = {
  type: 'add_tag'
  version: 1
  tags: string[]
}
```

## 7. Execution graph semantics

The graph must be **config-constrained**, not arbitrary.

### 7.1 Canonical semantics

- Exactly one trigger node.
- Condition nodes evaluate one typed condition tree.
- Action nodes execute in deterministic sequence.
- Branch semantics come from typed edge ports:
  - `matched`
  - `unmatched`
  - `next`
- No general user-authored `merge`.
- No implicit parallel execution from "multiple outgoing edges."

### 7.2 Why no implicit parallelism

The earlier draft allowed multiple outgoing edges from one source handle to imply parallel action execution. That is the wrong default for email and webhook side effects. Serial execution is easier to reason about, easier to log, and safer for retries and partial failures.

If explicit parallel branches are ever needed, that should be a future typed config primitive such as `parallel_group`, not an emergent behavior of free-form wiring.

### 7.3 Validation rules

Server-side validation on save:

- top-level config `type === 'email_automation'`
- top-level config `version === 1`
- layout config `type === 'react_flow_layout'`
- layout config `version === 1`
- exactly one trigger node
- every node declares `type` and `version`
- every nested config declares `type` and `version`
- every action config matches its declared `actionType`
- every predicate field/operator pair is valid
- every regex compiles
- every header predicate includes `headerName`
- graph is acyclic
- every action is reachable from the trigger
- every condition outgoing edge uses only `matched` or `unmatched`
- every non-condition edge uses only `next` or no port

## 8. React Flow rendering model

React Flow is the editor and renderer, not the business contract.

### 8.1 Canonical persisted data

- `AutomationRevision.config`
- `AutomationRevision.layout`

### 8.2 Derived React Flow data

React Flow `nodes` and `edges` are built from:

- executable config
- saved layout positions

Derived at render time:

- node labels
- source/target handles
- edge labels
- validation badges
- node icons and colors
- disabled/connectable state

### 8.3 What stays out of persisted config

Do not store these in the canonical revision:

- `selected`
- `dragging`
- `measured`
- `width`
- `height`
- hover state
- open panel state
- unsaved form draft state

These are UI-only and should remain client-side or per-user session data.

### 8.4 Editor shape

- `/automations` list page
- `/automations/[id]` editor page
- `/automations/[id]/runs/[runId]` run detail page
- Left palette for trigger / condition / action node templates
- Right-side sheet for node config
- Bottom run log panel
- React Flow nodes:
  - `TriggerNode`
  - `ConditionNode`
  - `ActionNode`

## 9. API surface

All routes follow existing auth and response helpers.

```text
GET    /api/v1/automations
POST   /api/v1/automations
GET    /api/v1/automations/[id]
PATCH  /api/v1/automations/[id]
DELETE /api/v1/automations/[id]

GET    /api/v1/automations/[id]/revisions
GET    /api/v1/automations/[id]/revisions/[revisionId]
POST   /api/v1/automations/[id]/activate-revision

POST   /api/v1/automations/[id]/dry-run
GET    /api/v1/automations/[id]/runs
GET    /api/v1/automations/[id]/runs/[runId]
POST   /api/v1/automations/[id]/runs/[runId]/replay
POST   /api/v1/automations/[id]/duplicate
```

`PATCH /api/v1/automations/[id]` creates a **new revision**. It does not mutate the old revision document in place.

## 10. Email ingest integration

Hook point remains `app/api/v1/webhooks/email/route.ts`, where the system currently stores incoming `EmailMessage` rows after fetching the Resend payload.

Desired flow:

```text
POST /api/v1/webhooks/email
  -> validate signature
  -> fetch full email from Resend
  -> store EmailMessage
  -> capture attachment metadata
  -> find active automations for org / inbox
  -> for each automation:
       capture activeRevisionId
       create AutomationRun(status=queued, automationRevisionId=...)
       dispatch executor
```

Why capture `automationRevisionId` at enqueue time:

- later edits do not change what this run means
- replay remains exact
- audit output remains trustworthy

## 11. Outbound webhook delivery worker

`send_webhook` still requires a delivery worker. Smallest viable v1:

- create delivery records for attempts
- sign payload with HMAC-SHA256
- retry with exponential backoff
- mark node run failure after max attempts
- reuse the same worker for customer-facing `Webhook` deliveries

If this is cut from v1, `send_webhook` should stay in the config schema behind a feature gate only if both API validation and UI palette also respect that gate. Do not expose a saveable action type that cannot execute.

## 12. Execution and observability

Every run writes:

- one `AutomationRun`
- one `AutomationNodeRun` per executed config node

Captured per node:

- `configNodeId`
- `configNodeType`
- `branchTaken`
- `input`
- `output`
- `error`
- `startedAt`
- `finishedAt`

The important detail is that logs point back to stable config node ids, not ephemeral React Flow runtime ids.

## 13. Safety and limits

Defaults for v1:

| Guard | Default |
|---|---|
| Max actions per run | 50 |
| Max branch depth | 32 |
| Max condition nesting depth | 4 |
| Auto-reply once-per-sender window | 24h |
| Outbound email cap per org per hour | 200 |
| Drop inbound with `Auto-Submitted` loop signals | always |
| Loop detector | sender + subject hash within 60s |

If a guard trips, the system records `AutomationRun.status = skipped` with a structured `error.code`.

## 14. Testing

- Unit tests for config validation.
- Unit tests for typed condition evaluation.
- Unit tests for config-to-React-Flow compilation.
- Unit tests for layout round-tripping.
- API route tests for create/update/activate/dry-run/replay.
- Integration test for inbound webhook -> message persisted -> run queued -> actions executed.
- Replay test proving a run executes against the referenced `automationRevisionId`, not the latest revision.

## 15. Phasing

1. **Schema + migration.** Add `Automation`, `AutomationRevision`, `AutomationRun`, `AutomationNodeRun`, `EmailAttachment`.
2. **Config contract + validator.** Zod schemas for all typed config objects.
3. **Executor.** Evaluate typed condition AST, traverse graph, execute actions serially.
4. **API routes.** CRUD, revision activation, dry-run, runs, replay.
5. **Ingest hook.** Queue runs using the active revision id.
6. **Webhook delivery worker** or formally descope `send_webhook`.
7. **React Flow read-only renderer.** Build graph from config + layout.
8. **React Flow editing.** Palette, node config sheet, save-to-revision flow.
9. **Run history UI.**
10. **Sweepers and polish.**

## 16. Risks

- **In-process dispatch is fragile.** Acceptable for v1 only if documented.
- **Config migration drift.** Mitigate with `migrateConfigToLatest(config)` and immutable revisions.
- **Editor/runtime coupling.** Mitigated by keeping React Flow derived.
- **Webhook action gap.** If the delivery worker slips, the action must be hidden and rejected server-side.
- **Mail loops.** Requires RFC-compliant reply headers and sender throttling.

## 17. Open decisions for review

1. **Do we build the outbound webhook delivery worker in this ticket or defer `send_webhook`?** Recommendation: build it here.
2. **Should revisions be user-visible in the UI or initially internal only?** Recommendation: internal only for v1, but stored explicitly.
3. **Do we allow explicit `else` action chains in v1?** Recommendation: no. Start with `matched` actions and `unmatched` fallthrough.
4. **Do we allow nested condition groups deeper than one level?** Recommendation: yes, but cap depth at 4 in validation.
5. **Should per-user editor session state be persisted?** Recommendation: no in v1.

## 18. Recommendation summary

Best implementation for this ticket:

- Store automations as immutable, versioned, typed config revisions.
- Require `type` and `version` on every config object.
- Use a typed condition AST instead of raw JSONLogic as the storage contract.
- Keep action configs as discriminated unions.
- Persist React Flow layout separately from executable config.
- Render React Flow from config rather than treating it as the source of truth.
- Tie every run to `automationRevisionId`.

That gives InboxUI a stable automation DSL, safe migrations, deterministic execution, and a clean React Flow editor without coupling runtime behavior to canvas internals.
