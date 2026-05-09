# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Next.js dev server on port 4000
npm run build        # Production build
npm run start        # Production server on port 4000
npm run lint         # ESLint
npm run test         # Vitest (run once)
npm run test:watch   # Vitest watch mode
npx vitest run components/__tests__/emails-list.test.tsx   # Single test file
npx prisma migrate dev      # Apply migrations + regen client to lib/generated/prisma
npx prisma db seed          # Seed via prisma/seed.ts (creates test@example.com / password123)
```

`repo-info.md` exists but is gitignored and stale (says Next.js 15, no tests, token key `"token"`) — don't trust it.

## Required env vars (`.env`)

`DATABASE_URL`, `JWT_SECRET`, `AUTH_RESEND_API_KEY`, `WEBHOOK_SECRET`, `AUTH_EMAIL_FROM`, `AUTH_EMAIL_FROM_NAME`, `NEXT_PUBLIC_API_MODE`.

## Architecture

This is a Next.js 16 App Router app that is **both** the frontend and the API — there is no separate backend. UI pages and `/api/*` route handlers live in the same `app/` tree.

### Request flow

Browser → `lib/api-client.ts` → `/api/...` Next.js route handler → `getAuthenticatedUser` → Prisma → PostgreSQL.

- Base URL is built at runtime as `window.location.origin + '/api'` (see `lib/api-client.ts:6`). There is no `NEXT_PUBLIC_API_BASE_URL`.
- `NEXT_PUBLIC_API_MODE=local` is set but currently the client always hits same-origin `/api`.

### Auth (JWT, not cookies)

- **Client**: token in `localStorage.auth_token` (not `"token"`). `apiClient` adds `Authorization: Bearer <token>`. On 401 it clears the token and redirects to `/auth/login` unless already on an auth page (`lib/api-client.ts:127-134`).
- **Server**: `getAuthenticatedUser(request)` in `lib/auth-server.ts` parses the bearer token, verifies via `jsonwebtoken`, and loads the user with `memberships.organization` included. Every protected route calls this and returns `jsonError('Unauthorized', 401)` on null.
- `middleware.ts` excludes `/api` from its matcher and only does pass-through for public pages — **all real auth enforcement is per-route via `getAuthenticatedUser`**, not middleware.
- `<AuthGuard>` (in `app/layout.tsx`) is the client-side gate that redirects unauthenticated users to `/auth/login`. `<AuthProvider>` calls `/api/auth/me` once on mount and shares the user via `useAuth()` — don't fetch the user yourself, use the context.

### Response envelope (load-bearing)

All API routes use `lib/api-helpers.ts`:
- `jsonSuccess(data, status)` → `{ data }`
- `jsonError(message, status)` → `{ message }`

`lib/api-client.ts:147` unwraps `data.data` automatically. **If you write a route that returns a bare object instead of using `jsonSuccess`, the client will silently get the wrong shape.**

### Multi-tenancy model

Every resource (EmailInbox, PhoneInbox, ApiKey, Webhook, EmailMessage) is scoped to an `Organization` via `organizationId`, and a user accesses orgs through `Membership`. Auth-loaded user always has `memberships` with org included. Two scoping patterns coexist in the route handlers — match the existing pattern when extending:

- **User-scoped**: `where: { userId: user.id }` then verify `memberships.find(m => m.organizationId === body.organizationId)` before writing (e.g. `app/api/v1/apiKeys/route.ts`, `emailInbox/route.ts`).
- **Org-scoped**: `where: { organizationId: { in: user.memberships.map(m => m.organizationId) } }` (e.g. `app/api/webhooks/route.ts`).

### Email ingestion (Resend webhook)

`app/api/v1/webhooks/email/route.ts` receives `email.received` events from Resend.
- **HMAC validation**: `x-webhook-signature` + `x-webhook-timestamp` headers, verified against `WEBHOOK_SECRET`, with a 5-minute replay window (`validateSignature`). Uses `crypto.timingSafeEqual`.
- **Threading**: `determineThreading` first matches by `In-Reply-To` / `References` headers against `EmailMessage.messageId`, then falls back to subject match (stripped `Re:`/`Fwd:` prefix) within the same inbox. New threads use the new message's own DB id as `threadId`.
- Resend's outgoing `Message-ID` doesn't always match what the recipient sees, hence the subject fallback — don't remove it.
- Duplicates are silently skipped via Prisma error code `P2002` on the `(externalId, inboxEmailAddressId)` unique constraint.

### Prisma 7 (non-default setup)

- Generator is `prisma-client` (NOT `prisma-client-js`), output to `lib/generated/prisma` (gitignored).
- Import from `@/lib/generated/prisma/client`, **not** `@prisma/client`. Enums (e.g. `WebhookStatus`) also import from there.
- Datasource URL lives in `prisma.config.ts` (`process.env.DATABASE_URL`), not in `schema.prisma`.
- `PrismaClient` **requires** the `@prisma/adapter-pg` adapter: `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`. The shared instance is in `lib/db.ts` with the standard global-singleton pattern for hot reload.

### Next.js 16 specifics

- Dynamic route params are async: `{ params }: { params: Promise<{ id: string }> }`, must `await params`. See `app/api/v1/apiKeys/[id]/route.ts:6`.
- Dev/start ports default to 4000 in `package.json`.

### Testing (Vitest + MSW + jsdom)

- `test/setup.ts` starts MSW with `onUnhandledRequest: 'error'` — every fetch in a test must have a handler in `test/mocks/handlers.ts` or be overridden per-test.
- `next/navigation`, `next/link`, and `next-themes` are mocked globally in setup. `localStorage` is cleared between tests; `window.confirm` returns true; `navigator.clipboard` is stubbed.
- `vitest.config.ts` sets `NEXT_PUBLIC_API_MODE=local` and aliases `@` to repo root (matches `tsconfig.json` paths).
- Component tests live in `components/__tests__/` and `app/api-keys/__tests__/`.

## Known issues

- `app/phones/[id]/page.tsx` and `app/phones/page.tsx` have pre-existing TS errors around `MobileSidebarProps`. Don't be surprised by them, and don't fix them as a drive-by.
- `package.json#name` is still `my-v0-project` from the v0.app scaffold.
