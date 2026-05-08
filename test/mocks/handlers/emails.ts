import { http, HttpResponse } from 'msw'
import { mockEmails } from '../fixtures/emails'

const BASE = 'http://localhost:4000/api'

export const emailHandlers = [
  http.get(`${BASE}/v1/emailInbox`, () => {
    return HttpResponse.json({ data: [...mockEmails] })
  }),

  http.post(`${BASE}/v1/emailInbox`, async ({ request }) => {
    const body = (await request.json()) as { email: string; name?: string; organizationId: string }
    const newEmail = {
      id: 'email-new',
      organizationId: body.organizationId,
      userId: 'user-1',
      email: body.email,
      name: body.name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    return HttpResponse.json({ data: newEmail })
  }),

  http.delete(`${BASE}/v1/emailInbox/:id`, () => {
    return new HttpResponse(null, { status: 204 })
  }),
]
