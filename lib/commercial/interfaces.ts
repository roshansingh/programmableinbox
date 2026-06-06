/**
 * Policy: Determines if an operation is allowed
 */
export interface PolicyCheckRequest {
  organizationId: string
  action: 'email.process' | 'sms.process' | 'apiKey.create' | 'emailInbox.create' | 'phoneInbox.create'
  quantity?: number
}

export interface PolicyCheckResult {
  allowed: boolean
  reason?: string
}

export interface IPolicy {
  check(request: PolicyCheckRequest): Promise<PolicyCheckResult>
}

/**
 * Entitlements: Determines what features are available
 */
export interface EntitlementCheckRequest {
  organizationId: string
  feature: 'email_inboxes' | 'sms_inboxes' | 'automations' | 'webhooks' | string
}

export interface IEntitlements {
  canUse(request: EntitlementCheckRequest): Promise<boolean>
}

/**
 * Metering: Records usage metrics (fire-and-forget, never blocks)
 */
export interface MeteringRequest {
  organizationId: string
  metric: 'emails_processed' | 'sms_processed' | 'api_calls' | string
  quantity: number
  timestamp?: Date
}

export interface IMetering {
  record(request: MeteringRequest): Promise<void>
}
