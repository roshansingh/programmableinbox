# Password reset by signed JWT — design

Date: 2026-08-03
Status: approved (pending spec review)

## Summary

Add a forgot-password flow modelled on the existing email-verification feature
(issue #102): a stateless signed JWT mailed as a link, no token table, no
sweeper. Along the way, convert both token lifetimes from hardcoded constants
into validated integer environment variables, and correct the auth-page copy.

Three independent pieces ship together:

1. Copy — "disposable inbox" becomes "Programmable Inbox" on login and register.
2. Config — `EMAIL_VERIFICATION_SECRET` renamed to `EMAIL_LINK_SECRET` and
   shared by both token types, and token TTLs converted to `*_TTL_MINUTES`
   integer env vars, default 30.
3. Feature — the password reset request/confirm flow and its two pages.

## Decisions taken

| Decision | Choice | Consequence |
|---|---|---|
| Signing secret | One `EMAIL_LINK_SECRET` for both token types | The `purpose` claim becomes the only barrier between them; the rename is breaking for deployments |
| Session invalidation | Add `passwordChangedAt`; reject older JWTs | A reset evicts a stolen session |
| Password strength | Shared validator, min 8 / max 72 | Backfilled into register, which today enforces nothing |
| TTL configuration | `*_TTL_MINUTES` integers, default 30 | Existing deployments silently drop from 24h to 30m |

### One secret, and what that costs

Both emailed token types are signed with a single `EMAIL_LINK_SECRET`. A
separate `PASSWORD_RESET_SECRET` was specified in an earlier revision and
deliberately dropped: the property it protected is not the one doing the work.

**Why one key is sound.** The `purpose` claim sits inside the signed payload,
so changing it requires the key. An attacker cannot mint a reset token by
editing a verification token, whether or not the keys differ. Cross-redemption
needs a defect in a verifier, not merely a token in hand. And even granting
that defect, the reach is short: a verification token is only ever mailed to
the address on the account, so an attacker holds one only for a mailbox they
already control, where the ordinary reset flow was available to them anyway. A
second defect would also be needed, since a verification token carries no `pwh`
claim and confirm compares that against the row.

**What is genuinely given up**, stated plainly rather than argued away:

- **Blast radius.** One leaked key now mints both token types instead of one.
  `pwh` bounds this — holding the key still does not produce a working reset
  token without the victim's current password-hash fingerprint, which exists
  only in the database — but the exposure is wider than it would be with two.
- **Rotation independence.** Burning the key to invalidate outstanding reset
  links also invalidates every outstanding verification link, and the reverse.
  There is no way to rotate one without the other.

**Therefore the `purpose` check is load-bearing, not a backstop**, and the
implementation must treat it that way:

- Each verifier checks `purpose` with a strict equality test *before* reading
  any other claim.
- A dedicated test asserts cross-redemption fails in **both** directions — a
  verification token must not verify as a reset token, and vice versa. With one
  key this test is the only thing standing between the two types, so it is not
  optional and must not be weakened.
- `lib/auth/verification-token.ts:95-99` currently credits "the differing
  secret" for closing this attack. That is no longer true and the comment must
  be rewritten to say what actually holds the line.

A third barrier is unaffected and stays: `verifyToken` in `lib/auth-server.ts`
rejects *any* payload carrying a `purpose` claim, so neither emailed token can
ever be presented as a session credential — the RFC 8725 §2.8 Cross-JWT
Confusion class. That check is independent of how many signing keys exist.

### Renaming is a breaking change

`EMAIL_VERIFICATION_SECRET` → `EMAIL_LINK_SECRET` is a rename, not an addition.
Consequences, all intended:

- Any deployment with `ENABLE_EMAIL_VERIFICATION=true` **fails to boot** until
  its `.env` is updated. `assertConfig()` names the missing variable, so the
  failure is loud rather than silent.
- Every outstanding verification link stops working, because it was signed with
  the value under the old name. Affected users request a new one from the app.
- No compatibility shim is provided. Accepting the old name as a fallback would
  leave two spellings of one secret in the codebase indefinitely, and the
  feature shipped recently enough (PR #103) that the churn is small.

The rename lands as its own mechanical commit, separate from the feature work,
so the security-relevant diff stays readable. It touches 16 files.

## Config changes

New primitive: none. `zBoundedInt` already does the job.

```
emailVerification: {
  ENABLE_EMAIL_VERIFICATION              zBool,          default false
  EMAIL_LINK_SECRET                      zSecret min 16, required when enabled
  APP_BASE_URL                           zUrl,           required when enabled
  EMAIL_VERIFICATION_TOKEN_TTL_MINUTES   zBoundedInt(1, 10080), default 30
  PASSWORD_RESET_TOKEN_TTL_MINUTES       zBoundedInt(1, 10080), default 30
}
```

`EMAIL_LINK_SECRET` replaces `EMAIL_VERIFICATION_SECRET` in
`DOMAIN_SCHEMAS.emailVerification.vars`; the two TTLs are added. Every one of
them must appear in `.env.example` or the drift test fails. Upper bound 10080
minutes = 7 days.

The existing `requireEmailVerification()` accessor is reused unchanged by both
token modules — it already returns `{ secret, appBaseUrl }`, which is exactly
what each needs. No `requirePasswordReset()` is added: with one key there is
nothing for a second accessor to distinguish, and having two names for one
value invites the belief that they are different.

The `emailVerification` domain now holds variables that are not strictly about
email verification. Renaming it to something like `emailLinks` would be more
honest, but it is not done here: the domain name appears in `config.*`
accessors across the auth routes, and this change already carries one rename.
Noted as a follow-up rather than pretended away.

The TTLs are parsed to integers at boot rather than passed to `jwt.sign` as
duration strings: `expiresIn` accepts `ms`-format strings but throws on an unrecognised
one *at signing time*, which would surface as a 500 during signup rather than
as a boot failure. `expiresIn` receives `minutes * 60`.

`config.emailVerification` gains `tokenTtlMinutes` and
`passwordResetTtlMinutes`, both `number`.

### Copy that hardcodes "24 hours"

- `lib/email/verification-email.ts:62,74` — server-side, renders the real value
  via a `formatDuration(minutes)` helper (`<60` → "N minutes", exact hours →
  "N hours", exact days → "N days").
- `app/auth/verify/page.tsx:103` — a **public client page** with no access to
  server config. Rather than publish the TTL, the copy drops the number:
  "This link has expired. Sign in and send yourself a new one."

## Token module — `lib/auth/password-reset-token.ts`

`server-only`. Mirrors `verification-token.ts` in shape and result type, and
resolves its key through the same `requireEmailVerification()` accessor.

```ts
secret:  EMAIL_LINK_SECRET (shared with verification tokens)
purpose: 'password_reset'   ← the only thing separating the two types
claims:  { purpose, userId, email, pwh }
result:  { ok: true, claims } | { ok: false, reason: 'expired' | 'invalid' }
```

As in the verification module, the secret is resolved *outside* the `try` that
wraps `jwt.verify`, so a misconfigured key surfaces as a thrown error rather
than being swallowed into the `invalid` path where it is indistinguishable
from a merely bad link.

**`pwh` is what makes a stateless token single-use.** It is a truncated
SHA-256 fingerprint of the user's current `passwordHash`. Confirm recomputes it
from the row and rejects a mismatch, so completing a reset changes the hash and
kills every outstanding link for that user at once — no token table, no
cleanup job.

This property is why reset cannot simply copy verification's reasoning.
Verification tokens are safe to leave un-revoked because redemption grants one
idempotent boolean flip. A reset token grants account takeover, so
"redeemable more than once" and "not invalidated by a completed reset" are both
unacceptable.

`email` is in the claims for the same reason it is in the verification claims:
changing the address invalidates outstanding links without server state.

Every non-expiry failure collapses to `invalid`, exactly as verification does.

## Schema changes

```prisma
model User {
  passwordChangedAt        DateTime? @db.Timestamptz(3)
  passwordResetEmailSentAt DateTime? @db.Timestamptz(3)
}
```

Both nullable, both defaulting to null for existing rows. A null
`passwordChangedAt` means "never reset" and gates nothing, so no backfill is
needed.

## Session invalidation

`verifyToken` in `lib/auth-server.ts` today returns `{ userId }` and discards
the rest of the payload. It grows `iat`, and `resolveUserPrincipalFromToken`
rejects the credential when:

```
payload.iat * 1000 < user.passwordChangedAt
```

`passwordChangedAt` is added to the `select` of the query that already reads
`emailVerified`, so the check costs no extra round-trip.

The comparison fails closed: a token issued in the same wall-clock second as
the reset is rejected, because `iat` has one-second resolution. This is
harmless because **confirm deliberately does not issue a session** — the user
is sent to the login page to sign in with the new password, which also proves
the reset worked.

## Routes

Both `withPublic`, both returning 404 when `ENABLE_EMAIL_VERIFICATION` is off
(consistent with the confirm route: with the flag off this is not a misused
endpoint, it is a feature the deployment does not have).

Both must be added to `PUBLIC_APP_ROUTES` in `lib/__tests__/route-guards.test.ts:65`
or the structural guard fails.

### `POST /api/app/auth/password-reset/request`

Body `{ email }`. **Always returns `{ requested: true }` with status 200.**

The identical response is returned when the account does not exist, when the
60-second cooldown blocks the send, and when Resend fails. Returning a 429 only
for real accounts would itself be an enumeration oracle — the failure mode this
endpoint most needs to avoid, since it accepts an arbitrary third-party address
in the body. All three cases log; the caller learns nothing.

When the account exists and the cooldown has elapsed: sign, send, stamp
`passwordResetEmailSentAt`. The stamp happens only after a successful send and
under its own `try`, following the precedent set in the resend route — a failed
send must not start a cooldown, and a failed stamp must not report a send
failure for mail that already went out.

### `POST /api/app/auth/password-reset/confirm`

Body `{ token, password }`. In order:

1. Verify the token — `expired` and `invalid` get distinct messages.
2. Load the user; missing → the generic invalid message.
3. `user.email !== claims.email` → superseded message.
4. `pwh` mismatch → the generic invalid message (the link was already used).
5. Validate password strength.
6. Write `passwordHash`, `passwordChangedAt: now()`, clear
   `passwordResetEmailSentAt`.
7. Return `{ reset: true }`. **No session token.**

## Email — `lib/email/password-reset-email.ts`

`buildPasswordResetUrl(token)` → `${APP_BASE_URL}/auth/reset-password?token=…`.
Token is the only query parameter; a `redirect` parameter would make this an
open redirect carrying our sending domain's reputation.

Body states the real expiry, names the product, and says plainly that if the
recipient did not request it their password is unchanged and no action is
needed. Resend reports failures in the response body rather than throwing, so
the `error` field is checked and converted to a thrown error, as the
verification sender does.

## Password validation — `lib/validation/password.ts`

Dependency-free (imports nothing) so the client can use the messages without
pulling Pino into the browser bundle — the pattern established by
`lib/validation/inbox-policy-messages.ts`.

- Minimum 8 characters.
- Maximum 72 bytes: bcrypt silently truncates beyond 72, so a longer password
  gives a false sense of strength and makes two different passwords equivalent.

Used by `POST /auth/register` (newly enforced) and by reset confirm.

## Pages

Both reuse the `Shell` component pattern from `app/auth/verify/page.tsx` and
its `Suspense` boundary for `useSearchParams`.

### `/auth/forgot-password`

Email field → submit → a neutral confirmation that does not reveal whether the
account exists: "If an account exists for that address, we've sent a reset
link." The same screen shows regardless of outcome, matching the API.

### `/auth/reset-password?token=…`

New password + confirm fields, client-side length check using the shared
validator, submit, then redirect to `/auth/login`.

The token is scrubbed from the URL with `history.replaceState` before anything
else can observe it, exactly as the verify page does — left in place it
persists in browser history and leaks through the `Referer` header of any
third-party resource the page loads. This matters more here than for
verification, since the token grants account takeover.

Unlike the verify page, **the token is not redeemed on mount.** It is only sent
when the user submits a new password. Mail scanners and link previews pre-fetch
URLs; a GET-triggered redemption would burn the token before the human arrived.

## Testing

| Area | Coverage |
|---|---|
| `password-reset-token` | sign/verify round trip, expiry, tampered signature, missing/blank claims, wrong purpose, **cross-purpose confusion in both directions** |
| Config | TTL defaults, set-but-invalid throws, bounds; `EMAIL_LINK_SECRET` required when the flag is on; the old `EMAIL_VERIFICATION_SECRET` name is **not** honoured as a fallback |
| Request route | 404 when disabled, identical response for existing/nonexistent/cooled-down/send-failed, cooldown stamped only on success |
| Confirm route | 404 when disabled, expired vs invalid wording, email mismatch, `pwh` replay rejected, weak password rejected, `passwordChangedAt` written, no token returned |
| Session eviction | JWT issued before `passwordChangedAt` is rejected; issued after is accepted |
| Password validator | boundaries at 7/8 and 72/73 |
| Register | newly enforced minimum |
| Pages | both, including the enumeration-neutral confirmation and URL scrub |
| Route guards | both new routes in `PUBLIC_APP_ROUTES` |

`npm run test` must pass in full before the PR, per CLAUDE.md.

## Out of scope

- Rate limiting by IP. The per-account cooldown is the only throttle; an
  attacker enumerating many addresses is not slowed. Redis is optional in this
  deployment, so a shared counter is not available unconditionally.
- Changing password from inside the dashboard while signed in.
- Decoupling reset from `ENABLE_EMAIL_VERIFICATION`. Sharing one key makes the
  two features genuinely coupled: reset needs `EMAIL_LINK_SECRET`, which is
  only required — and therefore only guaranteed present — when the verification
  flag is on. Splitting them later means either a second key or moving the
  secret to its own always-required domain. With the flag off, the "Forgot
  password?" link on the login page leads to a page whose API returns 404.
  That is the real cost of the single-secret decision, and the first thing to
  revisit if a deployment wants reset without verification.

## Documentation

CLAUDE.md needs updating: the route-tree table's `withPublic` exception list,
the required-env-vars section, and a short subsection describing the flow
alongside the existing email-verification one.
