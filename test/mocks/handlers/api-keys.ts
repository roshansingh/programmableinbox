import { http, HttpResponse } from 'msw'
import { mockApiKeys } from '../fixtures/api-keys'

const BASE = 'http://localhost:4000/api'

export const apiKeyHandlers = [
  http.get(`${BASE}/v1/apiKeys`, () => {
    return HttpResponse.json({ data: [...mockApiKeys] })
  }),

  http.post(`${BASE}/v1/apiKeys`, async ({ request }) => {
    const body = (await request.json()) as { name: string; organizationId: string }
    const newKey = {
      id: 'key-new',
      apiKey: 'sk_live_newkeygenerated123456',
      name: body.name,
      organizationId: body.organizationId,
      userId: 'user-1',
      createdAt: new Date().toISOString(),
    }
    return HttpResponse.json({ data: newKey })
  }),

  http.delete(`${BASE}/v1/apiKeys/:id`, () => {
    return new HttpResponse(null, { status: 204 })
  }),
]
