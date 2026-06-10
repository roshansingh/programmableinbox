# LLM Enrichment: Auto-Categorization & Metadata Extraction

**Issue:** [#7](https://github.com/programmableinbox/inboxui/issues/7)
**Date:** 2026-06-10
**Status:** Approved

## Overview

Automatically enrich every incoming email using an LLM: assign one or more categories from a fixed taxonomy, and extract structured metadata (OTP, links, timestamps). Enrichment runs as the final step in the BullMQ webhook processing job. The feature is optional — disabled at the instance level when `LLM_PROVIDER` is unset, and gated per-organization via the entitlements system.

## Scope

- Auto-assign **categories** (system-defined, LLM-assigned) from a fixed 18-item taxonomy
- Extract **OTP** (dedicated indexed column), **links** (CTA-flagged), and **timestamps** into structured metadata
- Configurable LLM provider: Anthropic, OpenAI, OpenRouter, Ollama
- New API endpoint: `GET /api/v1/emailInbox/[id]/otp`
- New messages only — no retroactive backfill

## Taxonomy

The fixed set of categories (always system-defined, never user-editable):

| Category | Description |
|----------|-------------|
| Primary | Direct personal or professional communication |
| Promotions | Marketing emails with offers, sales, or coupons |
| Social | Notifications from social media platforms |
| Updates | Service or account-related alerts and changes |
| Receipts | Purchase confirmations and transaction summaries |
| Finance | Bank statements, billing, or investment info |
| Travel | Itineraries, bookings, and trip reminders |
| Support | Customer service messages and helpdesk tickets |
| Newsletters | Subscription-based editorial or digest content |
| Communities | Forum replies, group messages, and discussions |
| Security | OTPs, password resets, and login alerts |
| Scheduling | Calendar invites, appointments, and reschedules |
| Applications | Job or service applications and form submissions |
| Notifications | System-generated updates from tools or platforms |
| Education | Course content, assignments, and grades |
| Agents | Emails from or to automation agents or bots |
| Urgent | High-priority or negative sentiment messages |
| Spam | Unwanted or malicious emails flagged as junk |

## Tags vs Categories

These are distinct concepts with different ownership:

- **`tags`** (`String[]`) — user-controlled; set manually or via automation `add_tag` actions
- **`categories`** (`String[]`) — system-controlled; always LLM-assigned from the taxonomy above; never written by users or automations

## Schema Changes

Add three columns to `EmailMessage`:

```prisma
categories   String[]  @default([])   // LLM-assigned from fixed taxonomy
extractedOtp String?                  // null if no OTP found; indexed for /otp endpoint
metadata     Json?                    // null = not yet enriched; links + timestamps
```

Indexes:

```prisma
@@index([categories], type: Gin)    // enables array containment search
@@index([extractedOtp])             // supports findFirst for /otp endpoint
```

The `metadata` JSON shape (written as `{}` — never left `null` — after a successful enrichment run, even if no links or timestamps were found; `null` strictly means "not yet attempted"):

```typescript
type EmailMetadata = {
  links: Array<{
    url: string
    label?: string
    isCta: boolean
  }>
  timestamps: string[]   // UTC timestamps extracted from body
}
```

## LLM Abstraction

### Module layout

```
lib/llm/
  types.ts              # LLMProvider interface, EnrichmentResult type
  factory.ts            # reads env vars, returns correct adapter instance
  enrichment.ts         # enrichMessage(): full enrichment flow + DB write
  providers/
    anthropic.ts        # @anthropic-ai/sdk with tool_use structured output
    openai-compat.ts    # openai SDK — handles openai, openrouter, ollama
```

### Interface

```typescript
interface LLMProvider {
  enrich(subject: string, bodyText: string): Promise<EnrichmentResult>
}

type EnrichmentResult = {
  categories: string[]
  extractedOtp: string | null
  metadata: {
    links: Array<{ url: string; label?: string; isCta: boolean }>
    timestamps: string[]
  }
}
```

### Environment variables

| Variable | Required | Values / Notes |
|----------|----------|----------------|
| `LLM_PROVIDER` | No | `anthropic` \| `openai` \| `openrouter` \| `ollama` — unset disables enrichment entirely |
| `LLM_API_KEY` | When provider ≠ ollama | Provider API key |
| `LLM_MODEL` | No | Optional model override; each adapter has a sensible default |
| `LLM_BASE_URL` | Required for `ollama` | Base URL override; also usable for `openrouter` if non-default |

### Adapters

**`anthropic.ts`** — uses `@anthropic-ai/sdk`. Structured output via `tool_use`: defines a `enrich_email` tool with a JSON schema matching `EnrichmentResult`. The model is required to call the tool, guaranteeing parseable output.

**`openai-compat.ts`** — uses `openai` SDK. Covers OpenAI, OpenRouter (`baseURL: https://openrouter.ai/api/v1`), and Ollama (`baseURL: http://localhost:11434/v1`). Structured output via `response_format: { type: 'json_schema', json_schema: { ... } }`.

**Prompt strategy:** System prompt embeds the full taxonomy. User message contains only `subject` and plain-text `body` — HTML is excluded to minimize token usage. Both adapters use the same prompt text; only the structured-output mechanism differs.

## Enrichment Flow

`enrichMessage()` in `lib/llm/enrichment.ts`:

```
1. If LLM_PROVIDER unset → return (instance-level off switch)
2. CommercialProvider.entitlements.canUse({ organizationId, feature: 'llm_enrichment' })
   → if false, return (org-level gate)
3. If message.metadata !== null → return (idempotency: already enriched)
4. factory.getProvider() → LLMProvider
5. provider.enrich(message.subject, message.text) → EnrichmentResult
6. prisma.emailMessage.update({ categories, extractedOtp, metadata })
7. On any thrown error: logger.error + return (never rethrow — must not kill BullMQ job)
```

### BullMQ worker integration

`enrichMessage()` is called as the final step in the webhook worker, after automations have been dispatched:

```typescript
await saveMessage(...)
await dispatchAutomationsForEmail(...)
await enrichMessage(savedMessage)   // new — last step, safe to fail
```

Automations run before enrichment in v1. This means automation conditions cannot filter on `categories` for the triggering message. This is an acceptable limitation for v1.

## Entitlements

Add `'llm_enrichment'` to the `feature` union in `EntitlementCheckRequest` (`lib/commercial/interfaces.ts`):

```typescript
feature: 'email_inboxes' | 'sms_inboxes' | 'automations' | 'webhooks' | 'llm_enrichment' | string
```

- **OSS (`EnableAllEntitlements`):** returns `true` — no changes needed to the class
- **SaaS (`PlanEntitlements`):** gates `llm_enrichment` by plan tier — implementation is SaaS-side

## API Endpoint

### `GET /api/v1/emailInbox/[id]/otp`

Returns the most recently received OTP for a given inbox.

**Auth:** Standard bearer token, `getAuthenticatedUser`. Verifies the inbox belongs to the user's organization.

**Query:**
```typescript
prisma.emailMessage.findFirst({
  where: {
    inboxEmailAddressId: inboxId,
    organizationId: { in: user.memberships.map(m => m.organizationId) },
    extractedOtp: { not: null },
  },
  orderBy: { createdAt: 'desc' },
  select: { extractedOtp: true, createdAt: true, id: true },
})
```

**Response (200):**
```json
{
  "data": {
    "otp": "123456",
    "receivedAt": "2026-06-10T12:34:56.000Z",
    "messageId": "uuid"
  }
}
```

**Response (404):** `{ "message": "No OTP found for this inbox" }`

## UI

**Message list:** Category chips rendered below the subject line, using a muted/system visual style to distinguish them from user tags. Not shown if `categories` is empty.

**Message detail:** A collapsible "Extracted Info" section rendered below the email body, only when `metadata !== null`:
- **OTP** — displayed prominently with a one-click copy button
- **Links** — list of extracted URLs; CTA links visually flagged with a badge
- **Timestamps** — plain list of detected UTC times

**Loading state:** None for v1. Enrichment completes before the user typically opens a message. If `metadata === null`, the section is not rendered.

**Settings UI:** None. `LLM_PROVIDER` is the instance-level switch. Org-level entitlement is SaaS plumbing, not surfaced in the UI.

## Out of Scope (v1)

- Retroactive enrichment of existing messages
- Automation conditions that filter on `categories`
- UI for managing or customizing the category taxonomy
- Metering LLM API calls through the commercial layer
