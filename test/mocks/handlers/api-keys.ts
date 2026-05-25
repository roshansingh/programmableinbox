import { http, HttpResponse } from 'msw'
import { mockApiKeys, mockApiKeyList, mockCreatedApiKey } from '../fixtures/api-keys'

const BASE = 'http://localhost:4000/api'

export const apiKeyHandlers = [
  http.get(`${BASE}/v1/apiKeys`, ({ request }) => {
    // Always return the old format for backward compatibility with main branch tests
    // The worktree tests should use their own fixtures if they need the new format
    return HttpResponse.json({ data: [...mockApiKeys] })
  }),

  http.post(`${BASE}/v1/apiKeys`, async ({ request }) => {
    const body = (await request.json()) as any

    // If request includes scopes, return new format
    if (body.scopes) {
      return HttpResponse.json({
        data: {
          ...mockCreatedApiKey,
          name: body.name,
          organizationId: body.organizationId,
          scopes: body.scopes,
        },
      })
    }

    // Otherwise return old format
    return HttpResponse.json({
      data: {
        id: 'key-new',
        apiKey: 'sk_live_newkeygenerated123456',
        name: body.name,
        organizationId: body.organizationId,
        userId: 'user-1',
        createdAt: new Date().toISOString(),
      },
    })
  }),

  http.delete(`${BASE}/v1/apiKeys/:id`, () => {
    return new HttpResponse(null, { status: 204 })
  }),
]
