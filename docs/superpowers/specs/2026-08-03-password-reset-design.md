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
2. Config — token TTLs become `*_TTL_MINUTES` integer env vars, default 30.
3. Feature — the password reset request/confirm flow and its two pages.

## Decisions taken

| Decision | Choice | Consequence |
|---|---|---|
| Signing secret | Reuse `EMAIL_VERIFICATION_SECRET` | Reset is gated on `ENABLE_EMAIL_VERIFICATION`; the `purpose` claim becomes the *only* barrier between the two token types |
| Session invalidation | Add `passwordChangedAt`; reject older JWTs | A reset evicts a stolen session |
| Password strength | Shared validator, min 8 / max 72 | Backfilled into register, which today enforces nothing |
| TTL configuration | `*_TTL_MINUTES` integers, default 30 | Existing deployments silently drop from 24h to 30m |

### Why reuse of the secret needs care

`lib/auth/verification-token.ts:95-99` currently reads:

> The differing secret already closes the confusion attack; this exists so that
> a future refactor which "simplifies" the secrets does not silently reopen it

That comment stops being true the moment reset tokens are signed with the same
key. The `purpose` claim is then load-bearing, not a backstop. Therefore:

- Both verifiers check `purpose` with a strict equality test before reading any
  other claim.
- A dedicated test asserts the cross-redemption in **both** directions: a
  verification token must not verify as a reset token, and vice versa.
- The stale comment is rewritten to say what is actually true.

This is the single highest-risk part of the change. A verification token that
redeemed as a reset token would be account takeover from a link that is mailed
to unverified addresses.

## Config changes

New primitive: none. `zBoundedInt` already does the job.

```
emailVerification: {
  ENABLE_EMAIL_VERIFICATION              zBool,          default false
  EMAIL_VERIFICATION_SECRET              zSecret min 16, required when enabled
  APP_BASE_URL                           zUrl,           required when enabled
  EMAIL_VERIFICATION_TOKEN_TTL_MINUTES   zBoundedInt(1, 10080), default 30
  PASSWORD_RESET_TOKEN_TTL_MINUTES       zBoundedInt(1, 10080), default 30
}
```

Both vars are added to `DOMAIN_SCHEMAS.emailVerification.vars` and to
`.env.example`, or the drift test fails. Upper bound 10080 minutes = 7 days.

Parsed to an integer at boot rather than passed to `jwt.sign` as a duration
string: `expiresIn` accepts `ms`-format strings but throws on an unrecognised
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

`server-only`. Mirrors `verification-token.ts` in shape and result type.

```ts
purpose: 'password_reset'
claims:  { purpose, userId, email, pwh }
result:  { ok: true, claims } | { ok: false, reason: 'expired' | 'invalid' }
```

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
| Config | TTL defaults, set-but-invalid throws, bounds |
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
- Decoupling reset from `ENABLE_EMAIL_VERIFICATION`, which the chosen secret
  strategy rules out. With the flag off, the "Forgot password?" link on the
  login page leads to a page whose API returns 404.

## Documentation

CLAUDE.md needs updating: the route-tree table's `withPublic` exception list,
the required-env-vars section, and a short subsection describing the flow
alongside the existing email-verification one.
