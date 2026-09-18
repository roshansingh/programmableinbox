import { ProviderRecorder } from './recording-provider'
import { RowStore } from './row-store'

/**
 * The module-level singletons the vi.mock factories and the runner share.
 * They live in their own module so both sides import the same instance.
 */
export const store = new RowStore()
export const recorder = new ProviderRecorder()
