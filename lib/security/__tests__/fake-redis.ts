/**
 * Deterministic in-memory stand-in for the narrow Redis surface the rate
 * limiter uses (`lib/security/rate-limit.ts#RateLimitRedis`).
 *
 * The point is to exercise the *real* limiter logic — window arithmetic,
 * decision thresholds, lockout escalation — without a live Redis and without
 * re-implementing any of it in the test. Only the storage primitives are faked.
 *
 * The clock is explicit (`now`) so tests can jump across window boundaries and
 * past TTLs without sleeping.
 */

import type { RateLimitRedis } from '../rate-limit'

interface Entry {
  value: string
  /** Absolute expiry against this fake's clock, or null for "no TTL". */
  expiresAt: number | null
}

export class FakeRedis implements RateLimitRedis {
  private store = new Map<string, Entry>()

  /** Current fake time in ms. Tests mutate this directly or via `advance`. */
  public now: number

  /** When true, every command rejects — simulates an unreachable backend. */
  public failing = false

  /** When true, every command hangs forever — simulates a wedged backend. */
  public hanging = false

  /** Every command executed, in order, for assertions on round-trip shape. */
  public commands: string[][] = []

  constructor(now: number = Date.now()) {
    this.now = now
  }

  advance(ms: number): void {
    this.now += ms
  }

  reset(now: number = Date.now()): void {
    this.store.clear()
    this.commands = []
    this.now = now
    this.failing = false
    this.hanging = false
  }

  /**
   * Writes a key with no expiry, which real Redis reports as `PTTL -1`.
   * Reproduces a lock/counter key whose PEXPIRE was lost.
   */
  seedWithoutExpiry(key: string, value: string): void {
    this.store.set(key, { value, expiresAt: null })
  }

  /**
   * Commands whose name is in this set reject inside MULTI, leaving the other
   * queued replies successful — the partial-failure case real Redis produces on
   * e.g. WRONGTYPE.
   */
  public failCommands = new Set<string>()

  /** Number of live keys — used to assert the limiter is not leaking keys. */
  size(): number {
    return [...this.store.keys()].filter((key) => this.live(key) !== undefined).length
  }

  private live(key: string): Entry | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (entry.expiresAt !== null && entry.expiresAt <= this.now) {
      this.store.delete(key)
      return undefined
    }
    return entry
  }

  private guard(): void {
    if (this.failing) throw new Error('fake redis: connection refused')
  }

  private async maybeHang(): Promise<void> {
    if (this.hanging) await new Promise(() => {})
  }

  // --- primitive commands ---------------------------------------------------

  private incr(key: string): number {
    const entry = this.live(key)
    const next = Number(entry?.value ?? 0) + 1
    this.store.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? null })
    return next
  }

  private pexpireCmd(key: string, ms: number): number {
    const entry = this.live(key)
    if (!entry) return 0
    entry.expiresAt = this.now + ms
    return 1
  }

  private getCmd(key: string): string | null {
    return this.live(key)?.value ?? null
  }

  private run(command: unknown[]): unknown {
    const [name, ...args] = command as [string, ...unknown[]]
    this.commands.push(command.map(String))
    if (this.failCommands.has(name.toLowerCase())) {
      throw new Error(`WRONGTYPE fake failure for ${name}`)
    }
    switch (name.toLowerCase()) {
      case 'incr':
        return this.incr(String(args[0]))
      case 'pexpire':
        return this.pexpireCmd(String(args[0]), Number(args[1]))
      case 'get':
        return this.getCmd(String(args[0]))
      default:
        throw new Error(`fake redis: unsupported command ${name}`)
    }
  }

  // --- RateLimitRedis -------------------------------------------------------

  multi(commands: unknown[][]): { exec(): Promise<Array<[Error | null, unknown]> | null> } {
    return {
      exec: async () => {
        await this.maybeHang()
        this.guard()
        // Real MULTI/EXEC is atomic; a single-threaded fake trivially is too.
        return commands.map((command) => {
          try {
            return [null, this.run(command)] as [Error | null, unknown]
          } catch (error) {
            return [error as Error, null] as [Error | null, unknown]
          }
        })
      },
    }
  }

  async pttl(key: string): Promise<number> {
    await this.maybeHang()
    this.guard()
    this.commands.push(['pttl', key])
    const entry = this.live(key)
    if (!entry) return -2
    if (entry.expiresAt === null) return -1
    return entry.expiresAt - this.now
  }

  async pexpire(key: string, ms: number): Promise<number> {
    await this.maybeHang()
    this.guard()
    this.commands.push(['pexpire', key, String(ms)])
    return this.pexpireCmd(key, ms)
  }

  async set(key: string, value: string, mode: 'PX', ttl: number): Promise<unknown> {
    await this.maybeHang()
    this.guard()
    this.commands.push(['set', key, value, mode, String(ttl)])
    this.store.set(key, { value, expiresAt: this.now + ttl })
    return 'OK'
  }

  async del(...keys: string[]): Promise<number> {
    await this.maybeHang()
    this.guard()
    this.commands.push(['del', ...keys])
    let removed = 0
    for (const key of keys) {
      if (this.store.delete(key)) removed += 1
    }
    return removed
  }
}
