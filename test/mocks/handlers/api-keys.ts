import { http, HttpResponse } from 'msw'
import { mockApiKeyList, mockCreatedApiKey } from '../fixtures/api-keys'

const BASE = 'http://localhost:4000/api'

export const apiKeyHandlers = [
  http.get(`${BASE}/app/apiKeys`, () => {
    return HttpResponse.json({ data: [...mockApiKeyList] })
  }),

  http.post(`${BASE}/app/apiKeys`, async ({ request }) => {
    const body = (await request.json()) as {
      name: string
      organizationId: string
      scopes: string[]
    }

    return HttpResponse.json({
      data: {
        ...mockCreatedApiKey,
        name: body.name,
        organizationId: body.organizationId,
        scopes: body.scopes,
      },
    })
  }),

  http.delete(`${BASE}/app/apiKeys/:id`, () => {
    return new HttpResponse(null, { status: 204 })
  }),
]
