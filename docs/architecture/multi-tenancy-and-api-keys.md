# Multi-tenancy, scopes, and API keys

## Organizations

Every resource — `EmailInbox`, `PhoneInbox`, `ApiKey`, `Webhook`, `EmailMessage` — is scoped to
an `Organization` via `organizationId`. A user reaches an organization through `Membership`; an
API key is bound to exactly one organization at creation.

Route handlers never query with a raw principal (user or API key). They convert it into one of
two scope types from `lib/services/scope.ts` first, and the service layer only ever sees the
scope — never the credential it came from, so a service function can't accidentally branch on
"is this a user or a key":

- **`OrgScope` — who can see.** Organization-wide for both principal kinds: a user gets every
  organization they belong to, a key gets the one it's bound to. Produced by
  `toOrgScope(principal, requestedOrganizationId?)`, which is the single place the membership
  check happens.
- **`OwnerScope` — who can change.** Creator-only, and deliberately a *different type* from
  `OrgScope`. Only a `UserPrincipal` can produce one (`toOwnerScope`) — **an API key can never
  reach a mutating service**, and that's enforced by the compiler rather than by a runtime check
  in each handler. `lib/services/__tests__/scope.test-d.ts` is a type-level test that fails if
  this separation is ever weakened.

Reads are organization-wide; mutation authority is not. A user can therefore see inboxes they
didn't create but can't rename or delete — the UI reflects this by having `serializeAppInbox`
compute an `isOwner` flag, so actions that would 404 aren't rendered in the first place.

## API keys

- **Storage**: the raw key is never stored. `keyHash` holds a SHA-256 hash; `prefix` holds the
  first 12 characters for display.
- **Creation** happens only from the dashboard (`POST /api/app/apiKeys`, not anywhere under
  `/api/v1`), and returns the full `sk_live_*` key exactly once. There's no way to retrieve it
  again — only the prefix.
- **Listing** returns `prefix` and `scopes` only, via `serializeApiKey()`. Never the hash, never
  the raw key.

### Scopes

Exactly five: `email_inboxes:read`, `email_messages:read`, `email_inboxes:create`,
`email_inboxes:update`, `email_inboxes:delete`. Checked against `API_KEY_SCOPE_SET` on creation.
Every scope names its domain (`email_inboxes:*` rather than a bare `inboxes:*`) because
`PhoneInbox` already exists in the schema, and an unprefixed name would eventually need renaming
or would silently widen to cover the wrong resource.

`DEFAULT_API_KEY_SCOPES` is enumerated explicitly, not spread from the full scope list — that's
load-bearing, not just tidy: a spread would hand every newly created key the delete scope by
default.

**Create, update, and delete are three separate scopes because they aren't equally dangerous to
confuse.** Create and update are recoverable mistakes. Delete isn't: `deleteInbox` soft-deletes
the inbox and its messages, but the address itself (`EmailInbox.email`) is a plain unique index —
not partial on `deletedAt IS NULL` — so the address stays retired forever. There's no restore
path. Three phantom-typed scope structs (`InboxWriteScope`, `InboxDeleteScope`, and the untouched
`OwnerScope` used by message deletion) keep these apart at the type level, not just at the route
declaration, so a handler that should only ever get update access can't accidentally be handed
delete access by a refactor.

**Pre-rename scope names are still accepted, for one release.** `LEGACY_SCOPE_ALIASES` maps the
old `inboxes:read` / `messages:read` names forward at the two places scopes are compared
(`withApiKey`, and the MCP `authorize()` function), so a key minted before the rename doesn't
start 403ing the moment the migration runs. The table is one-way: nothing maps onto the write or
delete scopes, since a rename must never itself be a privilege grant.

### Inbox creation policy

Two rules apply on every inbox create/rename path (`lib/validation/inbox-policy.ts`):

- **Domain allowlist** — an inbox address must be on one of the domains configured via
  `EMAIL_INBOX_DOMAINS`. A domain we don't control can't receive mail for the inbox, so this
  isn't optional.
- **Impersonation blocklist** — `lib/security/blocked-inbox-terms.ts` checks the local part and
  display name against known brand/impersonation terms, normalizing for leetspeak and separator
  tricks (`g-o-o-g-l-e`, `g00gle` → `google`). Distinctive brand names match as substrings; short
  or English-colliding terms (`pi`, `x`, `ups`, `chase`) match only as whole tokens, so `pizza`
  and `purchase` survive.

Both the create and the rename path call the same policy — a name check that only runs on
creation is trivially bypassed by creating a bland inbox and renaming it afterward.

## Related

- [auth.md](auth.md) — how a principal is resolved in the first place
- [rate-limiting-and-account-security.md](rate-limiting-and-account-security.md) — throttling
  around login/register, separate from the scopes described here
- [mcp-server.md](mcp-server.md) — the one place API key scopes are checked per-tool-call rather
  than per-route
