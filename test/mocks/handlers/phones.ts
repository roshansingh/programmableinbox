import { http, HttpResponse } from 'msw'
import { mockPhones, mockAvailableNumbers } from '../fixtures/phones'

const BASE = 'http://localhost:4000/api'

export const phoneHandlers = [
  http.get(`${BASE}/app/phoneInbox`, () => {
    return HttpResponse.json({ data: [...mockPhones] })
  }),

  http.get(`${BASE}/app/phoneInbox/available`, () => {
    return HttpResponse.json({ data: [...mockAvailableNumbers] })
  }),

  http.post(`${BASE}/app/phoneInbox`, async ({ request }) => {
    const body = (await request.json()) as { phoneNumber: string; countryCode: string; organizationId: string }
    const newPhone = {
      id: 'phone-new',
      organizationId: body.organizationId,
      phoneNumber: body.phoneNumber,
      countryCode: body.countryCode,
      status: 'active',
      capabilities: { sms: true, mms: false, voice: true },
      isOwner: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    return HttpResponse.json({ data: newPhone }, { status: 201 })
  }),

  http.delete(`${BASE}/app/phoneInbox/:id`, () => {
    return new HttpResponse(null, { status: 204 })
  }),
]
