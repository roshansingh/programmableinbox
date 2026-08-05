/**
 * Connection-establishment tests for lib/security/rate-limit.ts
 *
 * Every other test in this directory injects a client via
 * `setRateLimitRedisClient`, which is exactly the code path that cannot see
 * this class of bug: it hands the limiter a connection that is already usable.
 * These tests let the module open its own connection, with `ioredis` mocked by
 * a socket-free double that reproduces the one behaviour that matters —
 * `new Redis()` returns in state `connecting`, and with
 * `enableOfflineQueue: false` every command issued before `ready` is rejected.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { withConfigEnv } from '@/test/config'

/** Instances created by the mocked constructor, in order. */
const instances: FakeIoRedis[] = []

/**
 * The slice of ioredis the limiter touches, with a deliberately hostile
 * pre-`ready` phase.
 *
 * `becomeReady()` and `failToConnect()` are driven by the test rather than a
 * timer, so "did the limiter wait?" is decided by the code under test and not
 * by which macrotask happened to run first.
 */
class FakeIoRedis extends EventEmitter {
  status: 'connecting' | 'ready' | 'end' = 'connecting'
  /** Commands that were actually accepted, i.e. issued after `ready`. */
  accepted: unknown[][][] = []

  becomeReady() {
    this.status = 'ready'
    this.emit('ready')
  }

  failToConnect(message = 'connect ECONNREFUSED 127.0.0.1:6379') {
    this.status = 'end'
    this.emit('error', new Error(message))
  }

  multi(commands: unknown[][]) {
    return {
      exec: async () => {
        if (this.status !== 'ready') {
          throw new Error(
            "Stream isn't writeable and enableOfflineQueue options is false",
          )
        }
        this.accepted.push(commands)
        // One `[error, value]` pair per queued command; INCR is the only reply
        // this suite reads, and a first hit in a fresh window is 1.
        return commands.map((command) =>
          command[0] === 'incr' ? [null, 1] : [null, null],
        ) as Array<[Error | null, unknown]>
      },
    }
  }

  quit = async () => {
    this.status = 'end'
  }
}

vi.mock('ioredis', () => ({
  Redis: class {
    constructor() {
      const instance = new FakeIoRedis()
      instances.push(instance)
      return instance as unknown as never
    }
  },
}))

const POLICY = { limit: 5, windowMs: 60_000 }
const T0 = 1_700_000_000_000

describe('rate limit Redis connection establishment', () => {
  withConfigEnv({
    AUTH_RATE_LIMIT_ENABLED: 'true',
    REDIS_URL: 'redis://localhost:6379',
    RATE_LIMIT_TIMEOUT_MS: '250',
  })

  let consumeRateLimit: typeof import('../rate-limit').consumeRateLimit
  let setRateLimitRedisClient: typeof import('../rate-limit').setRateLimitRedisClient

  beforeEach(async () => {
    instances.length = 0
    // A fresh module registry per test, because the client is memoised for the
    // life of the module and this suite is about the very first request.
    vi.resetModules()
    const mod = await import('../rate-limit')
    consumeRateLimit = mod.consumeRateLimit
    setRateLimitRedisClient = mod.setRateLimitRedisClient
  })

  afterEach(() => {
    setRateLimitRedisClient(null)
  })

  /** Resolves once the mocked constructor has run and produced an instance. */
  async function firstInstance(): Promise<FakeIoRedis> {
    for (let i = 0; i < 50 && instances.length === 0; i += 1) {
      await new Promise((resolve) => setImmediate(resolve))
    }
    expect(instances).toHaveLength(1)
    return instances[0]
  }

  it('waits for the connection before issuing the first command', async () => {
    const decision = consumeRateLimit('test', 'k', POLICY, T0)

    const client = await firstInstance()
    // The connection is still opening. Nothing may have been sent yet — a
    // command issued now is the bug: it is rejected unsent, and the very first
    // login after a deploy silently skips the limiter.
    expect(client.accepted).toHaveLength(0)

    client.becomeReady()

    const result = await decision
    expect(result.degraded).toBe(false)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(POLICY.limit - 1)
    expect(client.accepted).toHaveLength(1)
  })

  it('reuses the ready connection for later requests', async () => {
    const first = consumeRateLimit('test', 'k', POLICY, T0)
    const client = await firstInstance()
    client.becomeReady()
    await first

    const second = await consumeRateLimit('test', 'k', POLICY, T0)

    expect(instances).toHaveLength(1)
    expect(second.degraded).toBe(false)
    expect(client.accepted).toHaveLength(2)
  })

  it('gives up on a refused connection without waiting out the budget', async () => {
    const decision = consumeRateLimit('test', 'k', POLICY, T0)

    const client = await firstInstance()
    client.failToConnect()

    // Fail-open is the default, so the request is allowed — but flagged, which
    // is what distinguishes an outage from a working limiter with room left.
    const result = await decision
    expect(result.degraded).toBe(true)
    expect(result.allowed).toBe(true)
    expect(client.accepted).toHaveLength(0)
  })
})
