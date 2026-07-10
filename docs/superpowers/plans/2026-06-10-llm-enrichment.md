# LLM Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically enrich every incoming email with LLM-assigned categories and extracted metadata (OTP, links, timestamps), plus expose a `/otp` endpoint per inbox.

**Architecture:** A new `lib/llm/` module defines a `LLMProvider` interface with Anthropic and OpenAI-compatible adapters (covering OpenAI, OpenRouter, Ollama). The BullMQ webhook worker calls `enrichMessage()` as a final step after automations. Schema adds `categories`, `extractedOtp`, and `metadata` columns to `EmailMessage`.

**Tech Stack:** `@anthropic-ai/sdk`, `openai` npm package, Prisma 7, BullMQ, Next.js 16 App Router, Vitest

---

## File Map

**Create:**
- `lib/llm/types.ts` — `LLMProvider` interface, `EnrichmentResult` type, `EMAIL_CATEGORIES`, shared JSON schema, `parseEnrichmentResult` normalizer
- `lib/llm/prompt.ts` — `buildSystemPrompt()` shared by both adapters
- `lib/llm/factory.ts` — reads `LLM_PROVIDER` env var, returns correct adapter or `null`
- `lib/llm/enrichment.ts` — `enrichMessage(messageId)`: entitlement check → call provider → write DB
- `lib/llm/providers/anthropic.ts` — Anthropic adapter using tool_use
- `lib/llm/providers/openai-compat.ts` — OpenAI-compatible adapter (openai, openrouter, ollama)
- `lib/llm/__tests__/enrichment.test.ts`
- `lib/llm/__tests__/factory.test.ts`
- `lib/llm/__tests__/anthropic.test.ts`
- `lib/llm/__tests__/openai-compat.test.ts`
- `app/api/v1/emailInbox/[id]/otp/route.ts` — GET endpoint returning latest OTP for an inbox
- `app/api/v1/emailInbox/__tests__/otp.test.ts`

**Modify:**
- `prisma/schema.prisma` — add `categories`, `extractedOtp`, `metadata` to `EmailMessage`
- `lib/commercial/interfaces.ts` — add `'llm_enrichment'` to `feature` union
- `lib/webhooks/worker.ts` — call `enrichMessage` after automation dispatch
- `lib/api/emails.api.ts` — add new fields to `EmailMessage` type, add `getLatestOtp` fn
- `app/emails/[id]/page.tsx` — add category chips to message list + extracted info panel in thread view

---

## Task 1: Schema migration

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add columns and indexes to `EmailMessage`**

  Open `prisma/schema.prisma`. Locate the `EmailMessage` model (currently ends with `@@index([messageId])` then `@@map("email_messages")`). Add the three new fields after `tags` and add two new index lines before `@@map`:

  ```prisma
  model EmailMessage {
    id                  String   @id @default(uuid())
    from                String
    to                  String[]
    bcc                 String[]
    cc                  String[]
    subject             String
    text                String
    html                String
    headers             Json
    externalId          String
    inboxEmailAddressId String
    organizationId      String
    threadId            String
    parentMessageId     String?
    messageId           String   @unique
    inReplyTo           String?
    references          String[]
    tags                String[] @default([])
    categories          String[] @default([])
    extractedOtp        String?
    metadata            Json?
    createdAt           DateTime @default(now())

    inboxEmailAddress EmailInbox     @relation(fields: [inboxEmailAddressId], references: [id], onDelete: Cascade)
    organization      Organization   @relation(fields: [organizationId], references: [id], onDelete: Cascade)
    parentMessage     EmailMessage?  @relation("EmailMessageReplies", fields: [parentMessageId], references: [id], onDelete: SetNull)
    replies           EmailMessage[] @relation("EmailMessageReplies")
    automationRuns    AutomationRun[]
    attachments       EmailAttachment[]

    @@unique([externalId, inboxEmailAddressId])
    @@index([inboxEmailAddressId])
    @@index([organizationId])
    @@index([externalId])
    @@index([threadId])
    @@index([parentMessageId])
    @@index([messageId])
    @@index([categories], type: Gin)
    @@index([extractedOtp])
    @@map("email_messages")
  }
  ```

- [ ] **Step 2: Run migration**

  ```bash
  npx prisma migrate dev --name add_llm_enrichment_columns
  ```

  Expected: migration file created in `prisma/migrations/`, Prisma client regenerated. The `email_messages` table now has `categories`, `extracted_otp`, and `metadata` columns.

- [ ] **Step 3: Commit**

  ```bash
  git add prisma/schema.prisma prisma/migrations/
  git commit -m "feat: add categories, extractedOtp, metadata columns to EmailMessage"
  ```

---

## Task 2: Entitlements interface update

**Files:**
- Modify: `lib/commercial/interfaces.ts`

- [ ] **Step 1: Add `'llm_enrichment'` to the feature union**

  In `lib/commercial/interfaces.ts`, find the `EntitlementCheckRequest` interface and update the `feature` field:

  ```typescript
  export interface EntitlementCheckRequest {
    organizationId: string
    feature: 'email_inboxes' | 'sms_inboxes' | 'automations' | 'webhooks' | 'llm_enrichment' | string
  }
  ```

  (`EnableAllEntitlements` already returns `true` for all features so no change needed there.)

- [ ] **Step 2: Commit**

  ```bash
  git add lib/commercial/interfaces.ts
  git commit -m "feat: add llm_enrichment to entitlements feature union"
  ```

---

## Task 3: Install LLM SDKs

- [ ] **Step 1: Install packages**

  ```bash
  npm install @anthropic-ai/sdk openai
  ```

  Expected: both packages appear in `package.json` dependencies. No peer dependency errors.

- [ ] **Step 2: Commit**

  ```bash
  git add package.json package-lock.json
  git commit -m "chore: install @anthropic-ai/sdk and openai packages"
  ```

---

## Task 4: LLM types and shared prompt

**Files:**
- Create: `lib/llm/types.ts`
- Create: `lib/llm/prompt.ts`

- [ ] **Step 1: Create `lib/llm/types.ts`**

  ```typescript
  export const EMAIL_CATEGORIES = [
    'Primary', 'Promotions', 'Social', 'Updates', 'Receipts', 'Finance',
    'Travel', 'Support', 'Newsletters', 'Communities', 'Security', 'Scheduling',
    'Applications', 'Notifications', 'Education', 'Agents', 'Urgent', 'Spam',
  ] as const

  export type EmailCategory = typeof EMAIL_CATEGORIES[number]

  export type EnrichmentMetadata = {
    links: Array<{ url: string; label?: string; isCta: boolean }>
    timestamps: string[]
  }

  export type EnrichmentResult = {
    categories: EmailCategory[]
    extractedOtp: string | null
    metadata: EnrichmentMetadata
  }

  export const ENRICHMENT_JSON_SCHEMA = {
    type: 'object',
    properties: {
      categories: {
        type: 'array',
        items: { type: 'string', enum: [...EMAIL_CATEGORIES] },
      },
      extractedOtp: { type: ['string', 'null'] },
      metadata: {
        type: 'object',
        properties: {
          links: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                url: { type: 'string' },
                label: { type: 'string' },
                isCta: { type: 'boolean' },
              },
              required: ['url', 'isCta'],
            },
          },
          timestamps: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['links', 'timestamps'],
      },
    },
    required: ['categories', 'extractedOtp', 'metadata'],
  } as const

  export interface LLMProvider {
    enrich(subject: string, bodyText: string): Promise<EnrichmentResult>
  }

  export function parseEnrichmentResult(raw: unknown): EnrichmentResult {
    if (typeof raw !== 'object' || raw === null) {
      return { categories: [], extractedOtp: null, metadata: { links: [], timestamps: [] } }
    }
    const obj = raw as Record<string, unknown>
    const meta = (obj.metadata as Record<string, unknown>) ?? {}
    return {
      categories: Array.isArray(obj.categories)
        ? (obj.categories as string[]).filter(
            (c): c is EmailCategory => (EMAIL_CATEGORIES as readonly string[]).includes(c)
          )
        : [],
      extractedOtp: typeof obj.extractedOtp === 'string' ? obj.extractedOtp : null,
      metadata: {
        links: Array.isArray(meta.links) ? (meta.links as EnrichmentMetadata['links']) : [],
        timestamps: Array.isArray(meta.timestamps) ? (meta.timestamps as string[]) : [],
      },
    }
  }
  ```

- [ ] **Step 2: Create `lib/llm/prompt.ts`**

  ```typescript
  import { EMAIL_CATEGORIES } from './types'

  export function buildSystemPrompt(): string {
    return `You are an email analysis assistant. Analyze the email and return structured JSON.

  CATEGORIES — select 1-3 that best describe the email (use exact names):
  ${EMAIL_CATEGORIES.join(', ')}

  RULES:
  - categories: Pick 1-3 from the list above. Always include at least one.
  - extractedOtp: If a numeric OTP, PIN, or verification code is present, return it as a string of digits only. Return null if none found.
  - metadata.links: Extract all URLs. Set isCta=true for primary action links (e.g. "Verify Email", "Confirm", "Reset Password", "Click here").
  - metadata.timestamps: Extract explicit date/time references as strings.

  Respond with JSON only, no prose. Match this structure exactly:
  {"categories":["..."],"extractedOtp":"123456 or null","metadata":{"links":[{"url":"...","label":"...","isCta":true}],"timestamps":["..."]}}`
  }
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add lib/llm/types.ts lib/llm/prompt.ts
  git commit -m "feat: add LLM enrichment types and shared prompt"
  ```

---

## Task 5: Anthropic adapter (TDD)

**Files:**
- Create: `lib/llm/__tests__/anthropic.test.ts`
- Create: `lib/llm/providers/anthropic.ts`

- [ ] **Step 1: Write the failing test**

  Create `lib/llm/__tests__/anthropic.test.ts`:

  ```typescript
  import { describe, it, expect, vi, beforeEach } from 'vitest'

  vi.mock('@anthropic-ai/sdk', () => {
    const mockCreate = vi.fn()
    return {
      default: vi.fn().mockImplementation(() => ({
        messages: { create: mockCreate },
      })),
      __mockCreate: mockCreate,
    }
  })

  describe('AnthropicAdapter', () => {
    let mockCreate: ReturnType<typeof vi.fn>

    beforeEach(async () => {
      vi.resetModules()
      const mod = await vi.importMock<{ __mockCreate: ReturnType<typeof vi.fn> }>('@anthropic-ai/sdk')
      mockCreate = (mod as any).__mockCreate
    })

    it('returns enrichment result from tool_use response', async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'tool_use',
            name: 'enrich_email',
            input: {
              categories: ['Security'],
              extractedOtp: '123456',
              metadata: {
                links: [{ url: 'https://example.com/verify', isCta: true }],
                timestamps: [],
              },
            },
          },
        ],
      })

      const { AnthropicAdapter } = await import('../providers/anthropic')
      const adapter = new AnthropicAdapter('test-key')
      const result = await adapter.enrich('Your OTP is 123456', 'Use code 123456 to verify.')

      expect(result.categories).toEqual(['Security'])
      expect(result.extractedOtp).toBe('123456')
      expect(result.metadata.links).toHaveLength(1)
      expect(result.metadata.links[0].isCta).toBe(true)
    })

    it('returns empty result when no tool_use block in response', async () => {
      mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'sorry' }] })

      const { AnthropicAdapter } = await import('../providers/anthropic')
      const adapter = new AnthropicAdapter('test-key')
      const result = await adapter.enrich('Hi', 'Hello')

      expect(result.categories).toEqual([])
      expect(result.extractedOtp).toBeNull()
      expect(result.metadata.links).toEqual([])
    })

    it('uses provided model when specified', async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'tool_use',
            name: 'enrich_email',
            input: { categories: ['Primary'], extractedOtp: null, metadata: { links: [], timestamps: [] } },
          },
        ],
      })

      const { AnthropicAdapter } = await import('../providers/anthropic')
      const adapter = new AnthropicAdapter('test-key', 'claude-opus-4-8')
      await adapter.enrich('Hello', 'World')

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-opus-4-8' })
      )
    })
  })
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  npx vitest run --project node lib/llm/__tests__/anthropic.test.ts
  ```

  Expected: FAIL — `Cannot find module '../providers/anthropic'`

- [ ] **Step 3: Create `lib/llm/providers/anthropic.ts`**

  ```typescript
  import Anthropic from '@anthropic-ai/sdk'
  import type { LLMProvider, EnrichmentResult } from '../types'
  import { ENRICHMENT_JSON_SCHEMA, parseEnrichmentResult } from '../types'
  import { buildSystemPrompt } from '../prompt'

  export class AnthropicAdapter implements LLMProvider {
    private client: Anthropic
    private model: string

    constructor(apiKey: string, model = 'claude-haiku-4-5-20251001') {
      this.client = new Anthropic({ apiKey })
      this.model = model
    }

    async enrich(subject: string, bodyText: string): Promise<EnrichmentResult> {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        system: buildSystemPrompt(),
        messages: [
          { role: 'user', content: `Subject: ${subject}\n\nBody:\n${bodyText.slice(0, 4000)}` },
        ],
        tools: [
          {
            name: 'enrich_email',
            description: 'Extract categories and metadata from the email',
            input_schema: ENRICHMENT_JSON_SCHEMA as Anthropic.Tool['input_schema'],
          },
        ],
        tool_choice: { type: 'tool', name: 'enrich_email' },
      })

      const toolUse = response.content.find((c) => c.type === 'tool_use')
      if (!toolUse || toolUse.type !== 'tool_use') {
        return parseEnrichmentResult(null)
      }
      return parseEnrichmentResult(toolUse.input)
    }
  }
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  npx vitest run --project node lib/llm/__tests__/anthropic.test.ts
  ```

  Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

  ```bash
  git add lib/llm/providers/anthropic.ts lib/llm/__tests__/anthropic.test.ts
  git commit -m "feat: add AnthropicAdapter with tool_use structured output"
  ```

---

## Task 6: OpenAI-compatible adapter (TDD)

**Files:**
- Create: `lib/llm/__tests__/openai-compat.test.ts`
- Create: `lib/llm/providers/openai-compat.ts`

- [ ] **Step 1: Write the failing test**

  Create `lib/llm/__tests__/openai-compat.test.ts`:

  ```typescript
  import { describe, it, expect, vi, beforeEach } from 'vitest'

  vi.mock('openai', () => {
    const mockCreate = vi.fn()
    return {
      default: vi.fn().mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      })),
      __mockCreate: mockCreate,
    }
  })

  describe('OpenAICompatAdapter', () => {
    let mockCreate: ReturnType<typeof vi.fn>

    beforeEach(async () => {
      vi.resetModules()
      const mod = await vi.importMock<{ __mockCreate: ReturnType<typeof vi.fn> }>('openai')
      mockCreate = (mod as any).__mockCreate
    })

    it('returns enrichment result from JSON response', async () => {
      const payload = {
        categories: ['Promotions'],
        extractedOtp: null,
        metadata: {
          links: [{ url: 'https://shop.example.com', label: 'Shop Now', isCta: true }],
          timestamps: [],
        },
      }
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(payload) } }],
      })

      const { OpenAICompatAdapter } = await import('../providers/openai-compat')
      const adapter = new OpenAICompatAdapter('test-key', 'gpt-4o-mini')
      const result = await adapter.enrich('Summer Sale!', 'Get 50% off today')

      expect(result.categories).toEqual(['Promotions'])
      expect(result.extractedOtp).toBeNull()
      expect(result.metadata.links[0].label).toBe('Shop Now')
    })

    it('passes baseURL when provided', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({ categories: ['Primary'], extractedOtp: null, metadata: { links: [], timestamps: [] } }) } }],
      })

      const OpenAI = (await vi.importMock<{ default: ReturnType<typeof vi.fn> }>('openai')).default
      const { OpenAICompatAdapter } = await import('../providers/openai-compat')
      new OpenAICompatAdapter('key', 'llama3.2', 'http://localhost:11434/v1')

      expect(OpenAI).toHaveBeenCalledWith(
        expect.objectContaining({ baseURL: 'http://localhost:11434/v1' })
      )
    })

    it('returns safe default when response content is malformed JSON', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'not json at all' } }],
      })

      const { OpenAICompatAdapter } = await import('../providers/openai-compat')
      const adapter = new OpenAICompatAdapter('test-key', 'gpt-4o-mini')
      const result = await adapter.enrich('Hi', 'Hello')

      expect(result.categories).toEqual([])
      expect(result.extractedOtp).toBeNull()
    })
  })
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  npx vitest run --project node lib/llm/__tests__/openai-compat.test.ts
  ```

  Expected: FAIL — `Cannot find module '../providers/openai-compat'`

- [ ] **Step 3: Create `lib/llm/providers/openai-compat.ts`**

  ```typescript
  import OpenAI from 'openai'
  import type { LLMProvider, EnrichmentResult } from '../types'
  import { parseEnrichmentResult } from '../types'
  import { buildSystemPrompt } from '../prompt'

  export class OpenAICompatAdapter implements LLMProvider {
    private client: OpenAI
    private model: string

    constructor(apiKey: string, model: string, baseURL?: string) {
      this.client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) })
      this.model = model
    }

    async enrich(subject: string, bodyText: string): Promise<EnrichmentResult> {
      const response = await this.client.chat.completions.create({
        model: this.model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: `Subject: ${subject}\n\nBody:\n${bodyText.slice(0, 4000)}` },
        ],
      })

      const content = response.choices[0]?.message?.content ?? ''
      try {
        return parseEnrichmentResult(JSON.parse(content))
      } catch {
        return parseEnrichmentResult(null)
      }
    }
  }
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  npx vitest run --project node lib/llm/__tests__/openai-compat.test.ts
  ```

  Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

  ```bash
  git add lib/llm/providers/openai-compat.ts lib/llm/__tests__/openai-compat.test.ts
  git commit -m "feat: add OpenAICompatAdapter covering openai, openrouter, ollama"
  ```

---

## Task 7: LLM factory (TDD)

**Files:**
- Create: `lib/llm/__tests__/factory.test.ts`
- Create: `lib/llm/factory.ts`

- [ ] **Step 1: Write the failing test**

  Create `lib/llm/__tests__/factory.test.ts`:

  ```typescript
  import { describe, it, expect, vi, afterEach } from 'vitest'

  vi.mock('../providers/anthropic', () => ({
    AnthropicAdapter: vi.fn().mockImplementation((key, model) => ({ _type: 'anthropic', key, model })),
  }))

  vi.mock('../providers/openai-compat', () => ({
    OpenAICompatAdapter: vi.fn().mockImplementation((key, model, baseURL) => ({ _type: 'openai-compat', key, model, baseURL })),
  }))

  describe('getProvider', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
      vi.resetModules()
    })

    it('returns null when LLM_PROVIDER is not set', async () => {
      vi.stubEnv('LLM_PROVIDER', '')
      const { getProvider } = await import('../factory')
      expect(getProvider()).toBeNull()
    })

    it('returns AnthropicAdapter for provider=anthropic', async () => {
      vi.stubEnv('LLM_PROVIDER', 'anthropic')
      vi.stubEnv('LLM_API_KEY', 'sk-ant-test')
      const { getProvider } = await import('../factory')
      const provider = getProvider() as any
      expect(provider._type).toBe('anthropic')
      expect(provider.key).toBe('sk-ant-test')
    })

    it('uses LLM_MODEL override when set', async () => {
      vi.stubEnv('LLM_PROVIDER', 'anthropic')
      vi.stubEnv('LLM_API_KEY', 'key')
      vi.stubEnv('LLM_MODEL', 'claude-opus-4-8')
      const { getProvider } = await import('../factory')
      const provider = getProvider() as any
      expect(provider.model).toBe('claude-opus-4-8')
    })

    it('returns OpenAICompatAdapter for provider=openai', async () => {
      vi.stubEnv('LLM_PROVIDER', 'openai')
      vi.stubEnv('LLM_API_KEY', 'sk-openai')
      const { getProvider } = await import('../factory')
      const provider = getProvider() as any
      expect(provider._type).toBe('openai-compat')
      expect(provider.baseURL).toBeUndefined()
    })

    it('returns OpenAICompatAdapter with ollama baseURL for provider=ollama', async () => {
      vi.stubEnv('LLM_PROVIDER', 'ollama')
      vi.stubEnv('LLM_API_KEY', '')
      const { getProvider } = await import('../factory')
      const provider = getProvider() as any
      expect(provider._type).toBe('openai-compat')
      expect(provider.baseURL).toBe('http://localhost:11434/v1')
    })

    it('uses LLM_BASE_URL override for ollama', async () => {
      vi.stubEnv('LLM_PROVIDER', 'ollama')
      vi.stubEnv('LLM_BASE_URL', 'http://my-ollama:11434/v1')
      const { getProvider } = await import('../factory')
      const provider = getProvider() as any
      expect(provider.baseURL).toBe('http://my-ollama:11434/v1')
    })

    it('returns null for unknown provider', async () => {
      vi.stubEnv('LLM_PROVIDER', 'unknown-provider')
      const { getProvider } = await import('../factory')
      expect(getProvider()).toBeNull()
    })
  })
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  npx vitest run --project node lib/llm/__tests__/factory.test.ts
  ```

  Expected: FAIL — `Cannot find module '../factory'`

- [ ] **Step 3: Create `lib/llm/factory.ts`**

  ```typescript
  import type { LLMProvider } from './types'

  const DEFAULT_MODELS: Record<string, string> = {
    anthropic: 'claude-haiku-4-5-20251001',
    openai: 'gpt-4o-mini',
    openrouter: 'openai/gpt-4o-mini',
    ollama: 'llama3.2',
  }

  const DEFAULT_BASE_URLS: Record<string, string> = {
    openrouter: 'https://openrouter.ai/api/v1',
    ollama: 'http://localhost:11434/v1',
  }

  export function getProvider(): LLMProvider | null {
    const provider = process.env.LLM_PROVIDER
    if (!provider) return null

    const apiKey = process.env.LLM_API_KEY ?? ''
    const model = process.env.LLM_MODEL || DEFAULT_MODELS[provider] || ''
    const baseURL = process.env.LLM_BASE_URL || DEFAULT_BASE_URLS[provider]

    switch (provider) {
      case 'anthropic': {
        const { AnthropicAdapter } = require('./providers/anthropic')
        return new AnthropicAdapter(apiKey, model)
      }
      case 'openai':
      case 'openrouter':
      case 'ollama': {
        const { OpenAICompatAdapter } = require('./providers/openai-compat')
        return new OpenAICompatAdapter(apiKey, model, baseURL)
      }
      default:
        return null
    }
  }
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  npx vitest run --project node lib/llm/__tests__/factory.test.ts
  ```

  Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

  ```bash
  git add lib/llm/factory.ts lib/llm/__tests__/factory.test.ts
  git commit -m "feat: add LLM provider factory with env-var-driven selection"
  ```

---

## Task 8: Enrichment function (TDD)

**Files:**
- Create: `lib/llm/__tests__/enrichment.test.ts`
- Create: `lib/llm/enrichment.ts`

- [ ] **Step 1: Write the failing test**

  Create `lib/llm/__tests__/enrichment.test.ts`:

  ```typescript
  import { describe, it, expect, vi, beforeEach } from 'vitest'
  import type { EnrichmentResult } from '../types'

  const mockEnrich = vi.fn<[string, string], Promise<EnrichmentResult>>()
  const mockGetProvider = vi.fn()
  const mockCanUse = vi.fn()
  const mockFindUnique = vi.fn()
  const mockUpdate = vi.fn()

  vi.mock('../factory', () => ({ getProvider: mockGetProvider }))
  vi.mock('@/lib/commercial/provider', () => ({
    CommercialProvider: { entitlements: { canUse: mockCanUse } },
  }))
  vi.mock('@/lib/db', () => ({
    prisma: {
      emailMessage: { findUnique: mockFindUnique, update: mockUpdate },
    },
  }))

  const ENRICHMENT_RESULT: EnrichmentResult = {
    categories: ['Security'],
    extractedOtp: '654321',
    metadata: { links: [], timestamps: [] },
  }

  describe('enrichMessage', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      mockGetProvider.mockReturnValue({ enrich: mockEnrich })
      mockCanUse.mockResolvedValue(true)
      mockFindUnique.mockResolvedValue({
        id: 'msg-1',
        subject: 'Your OTP',
        text: 'Code: 654321',
        metadata: null,
        organizationId: 'org-1',
      })
      mockEnrich.mockResolvedValue(ENRICHMENT_RESULT)
    })

    it('writes categories, extractedOtp, and metadata on success', async () => {
      const { enrichMessage } = await import('../enrichment')
      await enrichMessage('msg-1')

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'msg-1' },
        data: {
          categories: ['Security'],
          extractedOtp: '654321',
          metadata: { links: [], timestamps: [] },
        },
      })
    })

    it('skips when LLM_PROVIDER is not configured (getProvider returns null)', async () => {
      mockGetProvider.mockReturnValue(null)
      const { enrichMessage } = await import('../enrichment')
      await enrichMessage('msg-1')

      expect(mockFindUnique).not.toHaveBeenCalled()
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('skips when org is not entitled', async () => {
      mockCanUse.mockResolvedValue(false)
      const { enrichMessage } = await import('../enrichment')
      await enrichMessage('msg-1')

      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('skips when metadata is already set (idempotency)', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'msg-1', subject: 'Re', text: 'body', metadata: {}, organizationId: 'org-1',
      })
      const { enrichMessage } = await import('../enrichment')
      await enrichMessage('msg-1')

      expect(mockEnrich).not.toHaveBeenCalled()
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('does not throw when provider.enrich rejects', async () => {
      mockEnrich.mockRejectedValue(new Error('rate limit'))
      const { enrichMessage } = await import('../enrichment')
      await expect(enrichMessage('msg-1')).resolves.toBeUndefined()
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('writes metadata as empty object when enrichment returns no links/timestamps', async () => {
      mockEnrich.mockResolvedValue({
        categories: ['Primary'],
        extractedOtp: null,
        metadata: { links: [], timestamps: [] },
      })
      const { enrichMessage } = await import('../enrichment')
      await enrichMessage('msg-1')

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ metadata: { links: [], timestamps: [] } }),
        })
      )
    })
  })
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  npx vitest run --project node lib/llm/__tests__/enrichment.test.ts
  ```

  Expected: FAIL — `Cannot find module '../enrichment'`

- [ ] **Step 3: Create `lib/llm/enrichment.ts`**

  ```typescript
  import { prisma } from '@/lib/db'
  import { CommercialProvider } from '@/lib/commercial/provider'
  import { getProvider } from './factory'
  import logger from '@/lib/logger'

  export async function enrichMessage(messageId: string): Promise<void> {
    const provider = getProvider()
    if (!provider) return

    const message = await prisma.emailMessage.findUnique({
      where: { id: messageId },
      select: { id: true, subject: true, text: true, metadata: true, organizationId: true },
    })
    if (!message) return

    const entitled = await CommercialProvider.entitlements.canUse({
      organizationId: message.organizationId,
      feature: 'llm_enrichment',
    })
    if (!entitled) return

    if (message.metadata !== null) return

    try {
      const result = await provider.enrich(message.subject, message.text)
      await prisma.emailMessage.update({
        where: { id: messageId },
        data: {
          categories: result.categories,
          extractedOtp: result.extractedOtp ?? null,
          metadata: result.metadata,
        },
      })
    } catch (error) {
      logger.error({ error, messageId }, 'LLM enrichment failed')
    }
  }
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  npx vitest run --project node lib/llm/__tests__/enrichment.test.ts
  ```

  Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

  ```bash
  git add lib/llm/enrichment.ts lib/llm/__tests__/enrichment.test.ts
  git commit -m "feat: add enrichMessage function with entitlement gate and idempotency"
  ```

---

## Task 9: BullMQ worker integration

**Files:**
- Modify: `lib/webhooks/worker.ts`

- [ ] **Step 1: Import enrichMessage in the worker**

  At the top of `lib/webhooks/worker.ts`, add the import after the existing imports:

  ```typescript
  import { enrichMessage } from '@/lib/llm/enrichment'
  ```

- [ ] **Step 2: Call enrichMessage after automations in `processEmailWebhookJob`**

  In `processEmailWebhookJob`, find the block that dispatches automations (Step 3 comment) and the `console.log` that follows it. Add the enrichment step after automations:

  ```typescript
  // ------------------------------------------------------------------
  // Step 3: Dispatch automations
  // ------------------------------------------------------------------
  await Promise.all(
    storedMessages.map((message) => dispatchAutomationsForEmail(message.id)),
  );

  // ------------------------------------------------------------------
  // Step 4: LLM enrichment (best-effort, never throws)
  // ------------------------------------------------------------------
  await Promise.all(
    storedMessages.map((message) => enrichMessage(message.id)),
  );

  console.log(
    `[webhook-worker] email ${externalId} fully processed: ${storedMessages.length} message(s) stored, automations dispatched`,
  );
  ```

- [ ] **Step 3: Verify the full test suite still passes**

  ```bash
  npm run test
  ```

  Expected: all tests pass (334+ tests). The worker change has no unit tests of its own since `enrichMessage` is independently tested.

- [ ] **Step 4: Commit**

  ```bash
  git add lib/webhooks/worker.ts
  git commit -m "feat: call enrichMessage after automation dispatch in webhook worker"
  ```

---

## Task 10: OTP API endpoint (TDD)

**Files:**
- Create: `app/api/v1/emailInbox/__tests__/otp.test.ts`
- Create: `app/api/v1/emailInbox/[id]/otp/route.ts`

- [ ] **Step 1: Write the failing test**

  Create `app/api/v1/emailInbox/__tests__/otp.test.ts`:

  ```typescript
  import { describe, it, expect, vi, beforeEach } from 'vitest'
  import { NextRequest } from 'next/server'

  const mockGetAuthenticatedUser = vi.fn()
  const mockFindFirst = vi.fn()

  vi.mock('@/lib/auth-server', () => ({ getAuthenticatedUser: mockGetAuthenticatedUser }))
  vi.mock('@/lib/db', () => ({
    prisma: {
      emailInbox: { findFirst: mockFindFirst },
      emailMessage: { findFirst: mockFindFirst },
    },
  }))

  const MOCK_USER = {
    id: 'user-1',
    memberships: [{ organizationId: 'org-1' }],
  }

  function makeRequest(inboxId: string) {
    return new NextRequest(`http://localhost/api/v1/emailInbox/${inboxId}/otp`, {
      headers: { Authorization: 'Bearer mock-token' },
    })
  }

  describe('GET /api/v1/emailInbox/[id]/otp', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      vi.resetModules()
      mockGetAuthenticatedUser.mockResolvedValue(MOCK_USER)
    })

    it('returns 401 when not authenticated', async () => {
      mockGetAuthenticatedUser.mockResolvedValue(null)
      const { GET } = await import('../[id]/otp/route')
      const res = await GET(makeRequest('inbox-1'), { params: Promise.resolve({ id: 'inbox-1' }) })
      expect(res.status).toBe(401)
    })

    it('returns 404 when inbox does not belong to user org', async () => {
      mockFindFirst.mockResolvedValueOnce(null) // inbox not found
      const { GET } = await import('../[id]/otp/route')
      const res = await GET(makeRequest('inbox-1'), { params: Promise.resolve({ id: 'inbox-1' }) })
      expect(res.status).toBe(404)
    })

    it('returns 404 when no OTP found in inbox', async () => {
      mockFindFirst
        .mockResolvedValueOnce({ id: 'inbox-1' }) // inbox found
        .mockResolvedValueOnce(null)               // no message with OTP
      const { GET } = await import('../[id]/otp/route')
      const res = await GET(makeRequest('inbox-1'), { params: Promise.resolve({ id: 'inbox-1' }) })
      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.message).toMatch(/No OTP found/)
    })

    it('returns otp, receivedAt, messageId when found', async () => {
      const now = new Date('2026-06-10T12:00:00.000Z')
      mockFindFirst
        .mockResolvedValueOnce({ id: 'inbox-1' })
        .mockResolvedValueOnce({ extractedOtp: '987654', createdAt: now, id: 'msg-42' })
      const { GET } = await import('../[id]/otp/route')
      const res = await GET(makeRequest('inbox-1'), { params: Promise.resolve({ id: 'inbox-1' }) })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.otp).toBe('987654')
      expect(body.data.messageId).toBe('msg-42')
    })
  })
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  npx vitest run --project ui app/api/v1/emailInbox/__tests__/otp.test.ts
  ```

  Expected: FAIL — `Cannot find module '../[id]/otp/route'`

- [ ] **Step 3: Create `app/api/v1/emailInbox/[id]/otp/route.ts`**

  ```typescript
  import { NextRequest } from 'next/server'
  import { prisma } from '@/lib/db'
  import { getAuthenticatedUser } from '@/lib/auth-server'
  import { jsonSuccess, jsonError } from '@/lib/api-helpers'

  type RouteContext = { params: Promise<{ id: string }> }

  export async function GET(request: NextRequest, { params }: RouteContext) {
    const user = await getAuthenticatedUser(request)
    if (!user) return jsonError('Unauthorized', 401)

    const { id } = await params

    const inbox = await prisma.emailInbox.findFirst({
      where: {
        id,
        organizationId: { in: user.memberships.map((m) => m.organizationId) },
      },
      select: { id: true },
    })
    if (!inbox) return jsonError('Not found', 404)

    const message = await prisma.emailMessage.findFirst({
      where: {
        inboxEmailAddressId: id,
        extractedOtp: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      select: { extractedOtp: true, createdAt: true, id: true },
    })

    if (!message) return jsonError('No OTP found for this inbox', 404)

    return jsonSuccess({
      otp: message.extractedOtp,
      receivedAt: message.createdAt,
      messageId: message.id,
    })
  }
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  npx vitest run --project ui app/api/v1/emailInbox/__tests__/otp.test.ts
  ```

  Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

  ```bash
  git add app/api/v1/emailInbox/[id]/otp/route.ts app/api/v1/emailInbox/__tests__/otp.test.ts
  git commit -m "feat: add GET /api/v1/emailInbox/[id]/otp endpoint"
  ```

---

## Task 11: API client types and OTP helper

**Files:**
- Modify: `lib/api/emails.api.ts`

- [ ] **Step 1: Add enrichment fields to `EmailMessage` and add `getLatestOtp`**

  In `lib/api/emails.api.ts`, update the `EmailMessage` interface to add the three new fields after `references`:

  ```typescript
  export interface EmailMessage {
    id: string
    from: string
    to: string[]
    cc: string[]
    bcc: string[]
    subject: string
    text: string
    html: string
    headers: Record<string, string>
    externalId: string
    inboxEmailAddressId: string
    organizationId: string
    threadId: string
    parentMessageId: string | null
    messageId: string
    inReplyTo: string | null
    references: string[]
    tags: string[]
    categories: string[]
    extractedOtp: string | null
    metadata: {
      links: Array<{ url: string; label?: string; isCta: boolean }>
      timestamps: string[]
    } | null
    createdAt: string
  }
  ```

  Then add the `getLatestOtp` function at the end of the file:

  ```typescript
  export interface OtpResult {
    otp: string
    receivedAt: string
    messageId: string
  }

  export async function getLatestOtp(inboxId: string): Promise<OtpResult> {
    return apiClient.get<OtpResult>(`/v1/emailInbox/${inboxId}/otp`)
  }
  ```

- [ ] **Step 2: Run the full test suite**

  ```bash
  npm run test
  ```

  Expected: all tests pass. The type change is additive so existing tests are unaffected.

- [ ] **Step 3: Commit**

  ```bash
  git add lib/api/emails.api.ts
  git commit -m "feat: add categories/extractedOtp/metadata to EmailMessage type and getLatestOtp client"
  ```

---

## Task 12: UI — category chips in message list

**Files:**
- Modify: `app/emails/[id]/page.tsx`

- [ ] **Step 1: Add category chips to message list items**

  In `app/emails/[id]/page.tsx`, find the message list item block (inside `messages.map`). It currently ends with the `threadCount` badge. Add category chips after the text preview and before the thread count badge:

  ```tsx
  <p className="text-xs text-muted-foreground truncate">
    {message.text?.slice(0, 100) || '(No preview)'}
  </p>
  {message.categories && message.categories.length > 0 && (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {message.categories.slice(0, 3).map((cat) => (
        <Badge key={cat} variant="secondary" className="text-xs px-1.5 py-0 font-normal">
          {cat}
        </Badge>
      ))}
    </div>
  )}
  {(message as any).threadCount > 1 && (
    <Badge variant="outline" className="text-xs mt-2">
      {(message as any).threadCount} messages
    </Badge>
  )}
  ```

- [ ] **Step 2: Add category chips to the thread header**

  In the thread detail pane, find the `<h1>` that shows `selectedMessage.subject`. After the thread message count line, add category chips for the selected message:

  ```tsx
  {selectedMessage.categories && selectedMessage.categories.length > 0 && (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {selectedMessage.categories.map((cat) => (
        <Badge key={cat} variant="secondary" className="text-xs font-normal">
          {cat}
        </Badge>
      ))}
    </div>
  )}
  ```

  Place this after the `threadMessages.length > 1` paragraph block.

- [ ] **Step 3: Start the dev server and verify category chips render**

  ```bash
  npm run dev
  ```

  Open `http://localhost:4000/emails`. Open an inbox. If there are enriched messages, category chips should appear below the preview text in the list and in the thread header. If no messages are enriched yet (metadata is null), chips simply don't render — correct behavior.

- [ ] **Step 4: Commit**

  ```bash
  git add app/emails/[id]/page.tsx
  git commit -m "feat: display LLM category chips in message list and thread header"
  ```

---

## Task 13: UI — extracted info panel

**Files:**
- Modify: `app/emails/[id]/page.tsx`

- [ ] **Step 1: Add Copy icon import**

  In `app/emails/[id]/page.tsx`, the `Copy` icon is already imported from `lucide-react` — no change needed. Also add `Link` and `ExternalLink` if not already present. The current imports line is:

  ```tsx
  import { ArrowLeft, Trash2, Archive, Star, Reply, Forward, MoreVertical, Mail, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
  ```

  Update it to:

  ```tsx
  import { ArrowLeft, Trash2, Archive, Star, Reply, Forward, MoreVertical, Mail, ChevronDown, ChevronUp, RefreshCw, Copy, ExternalLink } from 'lucide-react'
  ```

  Also add the `toast` import if not already present:

  ```tsx
  import { toast } from 'sonner'
  ```

- [ ] **Step 2: Add extracted info panel inside each expanded thread message**

  In the thread message body section (inside `isExpanded && <div className="px-4 py-4">`), find the block that renders the HTML or text content. After it (before the reply/forward buttons block), add:

  ```tsx
  {msg.metadata && (
    <div className="mt-4 pt-3 border-t border-border space-y-3">
      {msg.extractedOtp && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">OTP</span>
          <code className="text-sm font-mono bg-muted px-2 py-0.5 rounded">{msg.extractedOtp}</code>
          <button
            onClick={() => {
              navigator.clipboard.writeText(msg.extractedOtp!)
              toast.success('OTP copied')
            }}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {msg.metadata.links.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Links</p>
          <div className="space-y-1">
            {msg.metadata.links.map((link, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline truncate max-w-sm"
                >
                  {link.label || link.url}
                </a>
                {link.isCta && (
                  <Badge variant="outline" className="text-xs px-1 py-0 shrink-0">CTA</Badge>
                )}
                <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
              </div>
            ))}
          </div>
        </div>
      )}
      {msg.metadata.timestamps.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Timestamps</p>
          <div className="space-y-0.5">
            {msg.metadata.timestamps.map((ts, i) => (
              <p key={i} className="text-xs text-muted-foreground">{ts}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  )}
  ```

- [ ] **Step 3: Verify in dev server**

  With `npm run dev` still running, open an enriched message. The extracted info section should appear below the email body when `metadata` is non-null and contains data. Unenriched messages show nothing.

- [ ] **Step 4: Run the full test suite**

  ```bash
  npm run test
  ```

  Expected: all tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add app/emails/[id]/page.tsx
  git commit -m "feat: add extracted info panel (OTP, links, timestamps) in thread message view"
  ```

---

## Final verification

- [ ] **Run the complete test suite**

  ```bash
  npm run test
  ```

  Expected: all tests pass, test count equal to or greater than pre-feature count.

- [ ] **Check TypeScript**

  ```bash
  npx tsc --noEmit
  ```

  Expected: no new errors (pre-existing errors in `app/phones/` are allowed).
