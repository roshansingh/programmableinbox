import { inspect } from 'node:util'
import { z } from 'zod'

const REDACTED = '[redacted]'

/**
 * A string that cannot be logged by accident.
 *
 * Every route a value can take into a log line renders `[redacted]`:
 * `String()` and template interpolation go through `toString`, Pino goes
 * through `toJSON`, and `console.log` goes through `util.inspect`. The raw
 * value is reachable only via the explicit, greppable `.reveal()`.
 *
 * This is why config exposes secrets as `Secret` rather than `string`: a plain
 * string in a config object leaks the moment someone writes
 * `logger.info({ config })`, and no amount of `toJSON` on the *parent* object
 * prevents it being pulled out and logged on its own.
 */
export class Secret {
  readonly #value: string

  constructor(value: string) {
    this.#value = value
  }

  /** The only way to read the underlying value. */
  reveal(): string {
    return this.#value
  }

  toString(): string {
    return REDACTED
  }

  toJSON(): string {
    return REDACTED
  }

  [inspect.custom](): string {
    return REDACTED
  }
}

/**
 * Schema for a secret environment variable: non-empty after trim, at least
 * `min` characters, boxed in a {@link Secret}.
 *
 * The failure message names the constraint but never echoes the value — a
 * validation error on `JWT_SECRET` must not print the secret.
 */
export function zSecret(opts: { min?: number } = {}) {
  const min = opts.min ?? 1
  return z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length >= min, {
      message:
        min === 1
          ? 'must not be empty'
          : `must be at least ${min} characters (after trimming)`,
    })
    .transform((value) => new Secret(value))
}
