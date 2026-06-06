import pino, { type Logger } from 'pino'
import { buildLoggerConfig } from './logger.config'

/**
 * Module-level singleton — initialized once on first access.
 * Using `undefined` as the sentinel avoids a `let` that could be re-assigned
 * unintentionally, while lazy initialization keeps cold-start cost zero.
 */
let _instance: Logger | undefined

/**
 * Return the shared Pino logger instance.
 *
 * Creates the instance on first call; subsequent calls return the same object.
 * Using a getter function (rather than a bare top-level `const`) allows tests
 * to reset the module via `vi.resetModules()` and get a fresh instance with
 * different env-driven config.
 */
export function getLogger(): Logger {
  if (!_instance) {
    _instance = pino(buildLoggerConfig())
  }
  return _instance
}

/**
 * Proxy object that delegates to the lazy-loaded singleton.
 * Allows direct method calls without invoking the function: `logger.error(...)` instead of `logger().error(...)`
 */
const loggerProxy = new Proxy({} as Logger, {
  get: (_, prop) => {
    const instance = getLogger()
    return instance[prop as keyof Logger]
  },
})

/**
 * Default export — allows direct method calls:
 *   `import logger from '@/lib/logger'`
 *   `logger.info(...)` / `logger.error(...)` / `logger.warn(...)`
 *
 * The proxy delegates to the lazy-loaded singleton, so initialization only
 * happens on first method call, not at module-load time.
 */
export default loggerProxy
