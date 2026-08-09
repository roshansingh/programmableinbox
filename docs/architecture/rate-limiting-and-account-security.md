# Rate limiting, lockout, verification, and password reset

Everything in this doc protects the account-creation and login surface:
`POST /api/app/auth/{login,register}` plus the flows that hang off them.

## Login/register rate limiting

`lib/security/rate-limit.ts` implements a **sliding-window counter**
(`estimate = prev × (1 − elapsed/window) + curr`), not a fixed window. A fixed window lets an
attacker spend a full budget right before a window boundary and another full budget right after,
for roughly double the intended rate over that boundary. The counter increments unconditionally
inside a single Redis `MULTI` (`INCR`, `PEXPIRE`, `GET prev`) — there's no separate read-then-write
step to race, and a rejected attempt still counts. Every reply in that `MULTI` is checked, not
just the `INCR` — a failed `PEXPIRE` or `GET` should make the limiter *under*-count, and
under-counting is the direction that must never fail silently.

**Defaults**: login 20/5min per IP and 10/15min per account; register 10/hour per IP and 5/hour
per address; lockout after 5 consecutive failures, starting at 1 minute and doubling to a 15
minute cap. All overridable via env — see `.env.example`.

### Three states of "no answer from Redis"

| State | Trigger | Behavior |
|---|---|---|
| Disabled | `AUTH_RATE_LIMIT_ENABLED=false` | No client, no commands. `degraded` is false — off by policy isn't a malfunction. |
| Unconfigured | limiter on, `REDIS_URL` unset | Never reaches runtime — `assertConfig()` refuses to boot. |
| Unreachable | configured but down/slow | Bounded by `RATE_LIMIT_TIMEOUT_MS` (250ms default), `enableOfflineQueue: false` — an immediate rejection, not a hang. `RATE_LIMIT_FAIL_MODE=open` (default) allows the request and flags it `degraded`; `closed` returns 429. |

Fail-open is the default because a Redis outage becoming a full login outage — including for the
operator who needs to log in to fix it — is worse than a temporarily unthrottled login form.

### Per-account limits report, they don't deny

The per-IP limit rejects before bcrypt runs — that's the control that actually caps CPU cost. The
per-account limit and lockout counters are incremented up front, but the password is still
checked: a *correct* password logs in and clears the lock, only a wrong one trips the 429.
Anything keyed purely on the submitted address, without that carve-out, is a denial-of-service
weapon pointed at the address's owner — anyone who knows your email could otherwise lock you out
indefinitely by submitting wrong passwords from a single host.

### `X-Forwarded-For` trust model

The production ingress (Caddy) *appends* the real client IP to any inbound `X-Forwarded-For`, so
the chain is `[...anything a client forged..., real IP]`. The limiter reads the entry at
`length − TRUSTED_PROXY_COUNT` from the **right**, never `split(',')[0]` — the leftmost entry is
whatever the client sent and is trivially forgeable into a fresh rate-limit budget per request.
IPv6 addresses bucket by `/64`, since residential ISPs commonly hand out a whole `/64` to one
customer.

When no trustworthy IP can be derived — header absent, chain shorter than expected, or
`TRUSTED_PROXY_COUNT=0` — per-IP limiting is **skipped** rather than falling back to a shared
bucket. A shared `unknown` bucket would put every user behind a proxy-less deployment (including
local dev) into one login budget together, which is a self-inflicted outage, not a conservative
default. Per-account limiting and lockout are unaffected either way.

### Enumeration safety

One message for every throttled outcome (`Too many login attempts...`), so a 429 doesn't leak
whether the account exists. Per-account counters key on the **submitted** address (SHA-256
bucketed — no plaintext address sits in Redis) and are recorded even for addresses that don't
exist, otherwise the presence or absence of a lockout becomes the oracle. Login compares against
a dummy bcrypt hash when no user matches, so a nonexistent account takes the same wall-clock time
as a wrong password on a real one.

## Email verification

Off unless `ENABLE_EMAIL_VERIFICATION=true`. When it's on, signup still returns a session token,
but every `withUser` route 403s with `Email verification required` until the address is proven —
a soft gate on API access, not a block on logging in.

- **The verification token is not a session token**, by three independent checks: it's signed
  with a dedicated key (`EMAIL_LINK_SECRET`, never the session-signing key), it carries a
  `{ purpose: 'email_verify', userId, email }` claim a session token doesn't have, and
  `verifyToken` rejects *any* token carrying a `purpose` claim at all when checking a session.
  This separation matters more here than it might elsewhere — a verification link travels by
  email, so it ends up in mail-provider logs, link scanners, and browser history, all places a
  session credential must never be exposed.
- **Stateless** — there's no token table and no cleanup job. Redemption is idempotent (it grants
  exactly one transition, `emailVerified: false → true`) and self-limiting, so an unrevoked old
  link is safe to leave outstanding.
- **`withUser` gained an opt-out (`allowUnverified: true`), not an opt-in** — verification is
  required by default, so a new route that never considered the flag fails closed rather than
  open. The allowlist is `auth/me` and `auth/verification/resend`, and a structural test pins
  that exact set.
- **A send failure never fails the signup.** The account already exists at that point; a 500
  there would leave a user who believes their signup failed but actually has an account. The
  failure is logged, and the gate screen's Resend button is the recovery path.
- Existing users are grandfathered to `emailVerified = true` by the migration that introduces the
  column, so turning the flag on doesn't lock out the current userbase.

## Password reset

Reset links share both the feature flag and the signing key with email verification —
**`purpose` is the only thing distinguishing a reset token from a verification token**, since the
signature check alone can't tell them apart. Both verifiers check `purpose` for strict equality
before reading anything else.

The token also carries `pwh`, a fingerprint of the password hash it was issued against — that's
what makes a stateless reset token single-use: completing the reset changes the hash, so every
other outstanding link for that account dies at once with nothing to sweep. Confirming a reset
also stamps `passwordChangedAt`, and session tokens issued before that timestamp are rejected —
so a password reset evicts an attacker's existing session, not just the credential they had.

`POST /api/app/auth/password-reset/request` returns an identical `{ requested: true }` regardless
of outcome (unknown address, cooldown, send failure) — any outcome-dependent response turns the
endpoint into an account-existence oracle, since it accepts an arbitrary third-party address.

## Related

- [auth.md](auth.md) — session resolution and the wrappers these flows sit inside
