import { describe, expect, it } from 'vitest'
import { Inflight } from './inflight'

const deferred = <T = void>() => {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('Inflight', () => {
  it('has nothing to wait for when nothing was tracked', async () => {
    await expect(new Inflight().settled()).resolves.toBeUndefined()
  })

  it('passes the tracked work through unchanged', async () => {
    const guard = new Inflight()

    await expect(guard.track(Promise.resolve(42))).resolves.toBe(42)
    await expect(guard.track(Promise.reject(new Error('boom')))).rejects.toThrow('boom')
  })

  it('settled() waits for tracked work that is still running', async () => {
    const guard = new Inflight()
    const work = deferred()
    guard.track(work.promise)

    let done = false
    const waiting = guard.settled().then(() => {
      done = true
    })
    await tick()
    expect(done).toBe(false)

    work.resolve()
    await waiting
    expect(done).toBe(true)
  })

  it('settled() never rejects, even when the tracked work failed', async () => {
    const guard = new Inflight()
    const work = deferred()
    const tracked = guard.track(work.promise)
    tracked.catch(() => {})

    work.reject(new Error('provider down'))

    await expect(guard.settled()).resolves.toBeUndefined()
  })

  it('waits for work tracked while it was already waiting', async () => {
    const guard = new Inflight()
    const first = deferred()
    const second = deferred()
    guard.track(first.promise)

    let done = false
    const waiting = guard.settled().then(() => {
      done = true
    })
    guard.track(second.promise)

    first.resolve()
    await tick()
    expect(done).toBe(false)

    second.resolve()
    await waiting
    expect(done).toBe(true)
  })

  it('is immediately settled again once everything has finished', async () => {
    const guard = new Inflight()
    guard.track(Promise.resolve())
    await guard.settled()

    await expect(guard.settled()).resolves.toBeUndefined()
  })

  it('lets a caller give up on slow work and still wait for it before reusing shared state', async () => {
    const guard = new Inflight()
    const shared: string[] = []

    // Case 1: slow work that writes to shared state after its caller timed out and moved on.
    guard.track(
      new Promise<void>((resolve) =>
        setTimeout(() => {
          shared.push('late write from the abandoned call')
          resolve()
        }, 20),
      ),
    )

    // Case 2 waits, then resets the shared state, exactly as the runner and benchmark do.
    await guard.settled()
    shared.length = 0
    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(shared).toEqual([])
  })
})
