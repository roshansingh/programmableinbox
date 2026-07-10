import { http, HttpResponse } from 'msw'

const BASE = 'http://localhost:4000/api'

export const accountHandlers = [
  http.patch(`${BASE}/v1/account/password`, async ({ request }) => {
    const body = (await request.json()) as { currentPassword: string; newPassword: string }
    if (body.currentPassword === 'wrong') {
      return HttpResponse.json({ message: 'Current password is incorrect' }, { status: 401 })
    }
    return HttpResponse.json({ data: { message: 'Password updated' } })
  }),

  http.patch(`${BASE}/v1/account/organization`, async ({ request }) => {
    const body = (await request.json()) as { organizationId: string; name: string }
    return HttpResponse.json({
      data: { id: body.organizationId, name: body.name, slug: 'test-org' },
    })
  }),
]
