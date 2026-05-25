export const API_KEY_SCOPES = [
  'inboxes:read',
  'messages:read',
  'messages:write',
  'automations:read',
  'automations:write',
] as const

export const API_KEY_SCOPE_SET = new Set(API_KEY_SCOPES)

export type ApiKeyScope = typeof API_KEY_SCOPES[number]
