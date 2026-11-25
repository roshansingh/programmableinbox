/**
 * Remembers work that a caller may have given up on, so the next user of the
 * shared singletons (the provider recorder, the row store, the token counter)
 * can wait for it to finish before resetting them.
 *
 * Vitest fails a timed-out test, and the benchmark abandons a call that
 * outlives its limit, but neither cancels the underlying promise: the provider
 * call is still running, and when it returns it writes to the recorder and the
 * store that the *next* case has just reset. On a single-slot local server it
 * also holds the slot, so the next request queues behind it and times out too.
 * A token check after the await cannot stop either, because both happen
 * before the continuation runs. Waiting does.
 */
export class Inflight {
  private pending = new Set<Promise<void>>()

  /** Run `work`, remember it until it settles (either way), and pass its result through unchanged. */
  track<T>(work: Promise<T>): Promise<T> {
    const settled = work.then(
      () => undefined,
      () => undefined,
    )
    this.pending.add(settled)
    void settled.then(() => this.pending.delete(settled))
    return work
  }

  /**
   * Resolves once everything tracked so far, including work tracked while
   * waiting, has settled. Never rejects: a failed call is the tracker's
   * business, not the waiter's.
   */
  async settled(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending])
  }
}
