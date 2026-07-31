import { http, HttpResponse } from 'msw'
import { mockUser } from '../fixtures/users'

const BASE = 'http://localhost:4000/api'

export const authHandlers = [
  http.get(`${BASE}/app/auth/me`, ({ request }) => {
    const auth = request.headers.get('Authorization')
    if (!auth || !auth.startsWith('Bearer ')) {
      return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }
    return HttpResponse.json({ data: mockUser })
  }),

  http.post(`${BASE}/app/auth/login`, async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string }
    if (body.email === 'test@example.com' && body.password === 'password') {
      return HttpResponse.json({
        data: { token: 'mock-jwt-token', user: mockUser },
      })
    }
    return HttpResponse.json({ message: 'Invalid credentials' }, { status: 401 })
  }),

  http.post(`${BASE}/app/auth/register`, async () => {
    return HttpResponse.json({
      data: { token: 'mock-jwt-token', user: mockUser },
    })
  }),
]
