import { config } from '@/lib/config'

/**
 * Initialize the commercial layer.
 *
 * For OSS: Uses permissive defaults (allow all, enable all, no metering)
 * For SaaS: Can be overridden by billing app with strict implementations
 *
 * Called from app/layout.tsx at app startup.
 */
export function initializeCommercial(): void {
  if (config.runtime.billing) {
    console.log('[Commercial] Billing enabled, waiting for billing app to configure...')
  } else {
    console.log('[Commercial] Billing disabled, using OSS defaults (allow all)')
  }

  // Lazy-loading ensures implementations are created on first access
  // No explicit initialization needed
}
