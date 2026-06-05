export const API_KEY_SCOPES = ['inboxes:read', 'messages:read'] as const

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number]

export const DEFAULT_API_KEY_SCOPES: ApiKeyScope[] = [...API_KEY_SCOPES]

export const API_KEY_SCOPE_SET = new Set<string>(API_KEY_SCOPES)
