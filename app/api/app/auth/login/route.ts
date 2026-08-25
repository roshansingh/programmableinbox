import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyPassword, signToken, formatUserResponse, setSessionCookie } from '@/lib/auth-server'
import { jsonSuccess, jsonError } from '@/lib/api-helpers'
import { withPublic } from '@/lib/auth/with-auth'
import {
  accountBucket,
  clearFailures,
  consumeClientIpRateLimit,
  consumeRateLimit,
  getClientIp,
  getLockoutState,
  getRateLimitConfig,
  lockoutHeaders,
  rateLimitHeaders,
  recordFailure,
} from '@/lib/security/rate-limit'
import logger from '@/lib/logger'

/**
 * Returned for every failed credential check, whether or not the account
 * exists. Do not vary this by outcome.
 */
const INVALID_CREDENTIALS = 'Invalid email or password'

/**
 * Returned for *every* throttled outcome — per-IP limit, per-account limit, and
 * temporary lockout alike. A single shared message means a 429 carries no
 * information about whether the submitted address belongs to a real account.
 */
const THROTTLED = 'Too many login attempts. Please try again later.'

const LOCKOUT_SCOPE = 'login'

/**
 * bcrypt hash of a random string at the same cost factor as `hashPassword`
 * (10). When no user matches, we still run a comparison against this so that
 * "account does not exist" and "wrong password" take the same wall-clock time.
 * Without it, the absence of a bcrypt round is a ~50ms enumeration oracle.
 */
const DUMMY_PASSWORD_HASH = '$2b$10$8tVtJ/kwKNWAfAcXxJgZa.bq72RPPHAeqO6mbGsOWudHtnxR4lrnq'

/**
 * Unauthenticated by design: a caller has no credential yet. withPublic
 * carries no behavior — it marks the intent so the structural guards can tell
 * "deliberately open" apart from "someone forgot the wrapper".
 *
 * ---------------------------------------------------------------------------
 * Why the throttles are checked in this order
 * ---------------------------------------------------------------------------
 * The per-IP limit REJECTS EARLY, before bcrypt. It is the control that caps
 * CPU: one source cannot make us run unbounded password hashes.
 *
 * The per-account limit and the lockout DO NOT reject early. They are consumed
 * up front — so the counters are honest, and so a rejected attempt still counts
 * against the attacker — but the password is verified regardless, and a
 * *correct* password logs in and clears the lock. Only a wrong password gets
 * the 429.
 *
 * That asymmetry exists because keying anything on the submitted address hands
 * an attacker a weapon aimed at its owner. Anyone who knows your email could
 * otherwise spend ten requests per fifteen minutes — roughly one every ninety
 * seconds, indefinitely, from a single host — and keep you permanently unable
 * to log in. The sliding window never decays below the limit under sustained
 * pressure, so unlike the lockout (which is capped at fifteen minutes) that
 * denial had no ceiling at all. Verifying first removes the weapon while
 * keeping the defence: someone guessing passwords is still throttled, because
 * their guesses are wrong.
 *
 * The cost is that a throttled-but-correct login runs bcrypt. That is bounded
 * by the per-IP limit above, which is where CPU protection belongs.
 */
export const POST = withPublic(async (request: NextRequest) => {
  try {
    const { email, password } = await request.json()

    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      return jsonError('Email and password are required', 400)
    }

    const config = getRateLimitConfig()
    const client = getClientIp(request)
    const bucket = accountBucket(email)

    // --- Per-IP limit: blunts password spraying from a single source. --------
    // Null when no trustworthy address could be derived; per-IP limiting is
    // then inactive by design rather than collapsing every caller into one
    // shared budget. See `getClientIp`.
    const ipDecision = await consumeClientIpRateLimit('login:ip', client, config.login.ip)
    if (ipDecision && !ipDecision.allowed) {
      logger.warn(
        { ip: client.ip, scope: ipDecision.scope, degraded: ipDecision.degraded },
        'Login rate limit exceeded for IP',
      )
      return jsonError(THROTTLED, 429, rateLimitHeaders(ipDecision))
    }

    // --- Per-account limit and lockout: consumed now, enforced only if the ---
    // --- password also turns out to be wrong. See the docblock above.      ---
    // Both key on the *submitted* address, so they behave identically for
    // addresses that have no account.
    const accountDecision = await consumeRateLimit(
      'login:account',
      bucket,
      config.login.account,
    )
    const lockout = await getLockoutState(LOCKOUT_SCOPE, bucket)

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        memberships: {
          include: { organization: true },
        },
      },
    })

    // Always run bcrypt — see DUMMY_PASSWORD_HASH.
    const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH)

    if (!user || !valid) {
      // Recorded for unknown addresses too, so lockout state cannot be used to
      // probe which addresses are registered.
      const { failures, lockedForSeconds } = await recordFailure(LOCKOUT_SCOPE, bucket)
      if (lockedForSeconds > 0) {
        logger.warn(
          { bucket, ip: client.ip, failures, lockedForSeconds },
          'Account temporarily locked out',
        )
      }

      // Wrong password AND over budget: this is the throttled case. The 429
      // body and headers are identical for a real and an unknown address.
      if (lockout.locked) {
        logger.warn(
          { bucket, ip: client.ip, retryAfterSeconds: lockout.retryAfterSeconds },
          'Login blocked by account lockout',
        )
        return jsonError(THROTTLED, 429, lockoutHeaders(lockout, config.login.account.limit))
      }
      if (!accountDecision.allowed) {
        logger.warn(
          { bucket, ip: client.ip, scope: accountDecision.scope, degraded: accountDecision.degraded },
          'Login rate limit exceeded for account',
        )
        return jsonError(THROTTLED, 429, rateLimitHeaders(accountDecision))
      }

      return jsonError(INVALID_CREDENTIALS, 401)
    }

    // Success clears the consecutive-failure counter and any active lockout —
    // including a lockout an attacker raised against this address.
    await clearFailures(LOCKOUT_SCOPE, bucket)

    const token = signToken({ userId: user.id })

    const response = jsonSuccess({ user: formatUserResponse(user) })
    setSessionCookie(response, token)
    return response
  } catch (error) {
    logger.error({ error }, 'Error logging in user')
    return jsonError('Internal server error', 500)
  }
})
