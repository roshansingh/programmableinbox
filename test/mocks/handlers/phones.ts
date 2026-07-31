import { http, HttpResponse } from 'msw'
import { mockPhones } from '../fixtures/phones'

const BASE = 'http://localhost:4000/api'

export const phoneHandlers = [
  http.get(`${BASE}/app/phoneInbox`, () => {
    return HttpResponse.json({ data: [...mockPhones] })
  }),

  http.post(`${BASE}/app/phoneInbox`, async ({ request }) => {
    const body = (await request.json()) as { phoneNumber: string; countryCode: string; organizationId: string }
    const newPhone = {
      id: 'phone-new',
      organizationId: body.organizationId,
      userId: 'user-1',
      phoneNumber: body.phoneNumber,
      countryCode: body.countryCode,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    return HttpResponse.json({ data: newPhone })
  }),

  http.delete(`${BASE}/app/phoneInbox/:id`, () => {
    return new HttpResponse(null, { status: 204 })
  }),
]
