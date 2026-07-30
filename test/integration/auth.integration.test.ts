import { describe, it, expect } from 'vitest'
import { POST as register } from '@/app/api/auth/register/route'
import { POST as login } from '@/app/api/auth/login/route'
import { GET as me } from '@/app/api/auth/me/route'
import { prisma } from '@/lib/db'
import { createOrgWithUser } from './helpers/auth'
import { jsonRequest } from './helpers/request'

describe('POST /api/auth/register', () => {
  it('400 when email or password is missing', async () => {
    const res = await register(jsonRequest('http://localhost/api/auth/register', {
      method: 'POST',
      body: { email: 'nopass@test.dev' },
    }))
    expect(res.status).toBe(400)
    const { message } = await res.json()
    expect(message).toBe('Email and password are required')
  })

  it('creates a user + name-derived organization + owner membership, returns token + user', async () => {
    const email = `register-${Date.now()}@test.dev`
    const res = await register(jsonRequest('http://localhost/api/auth/register', {
      method: 'POST',
      body: { email, password: 'password123', firstName: 'Reg', lastName: 'User' },
    }))
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(typeof data.token).toBe('string')
    expect(data.user.email).toBe(email)
    expect(data.user.firstName).toBe('Reg')
    expect(data.user.lastName).toBe('User')
    expect(data.user.organizations).toHaveLength(1)
    expect(data.user.organizations[0].name).toBe('Reg User')
    expect(data.user.organizations[0].role).toBe('owner')

    const dbUser = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: { memberships: { include: { organization: true } } },
    })
    expect(dbUser.memberships).toHaveLength(1)
    expect(dbUser.memberships[0].role).toBe('owner')
    expect(dbUser.memberships[0].organization.name).toBe('Reg User')

    // password must be hashed, never stored in plaintext
    expect(dbUser.passwordHash).not.toBe('password123')
    expect(dbUser.passwordHash.length).toBeGreaterThan(20)
  })

  it('409 on duplicate email', async () => {
    const email = `dupe-${Date.now()}@test.dev`
    const first = await register(jsonRequest('http://localhost/api/auth/register', {
      method: 'POST',
      body: { email, password: 'password123' },
    }))
    expect(first.status).toBe(200)

    const second = await register(jsonRequest('http://localhost/api/auth/register', {
      method: 'POST',
      body: { email, password: 'password123' },
    }))
    expect(second.status).toBe(409)
    const { message } = await second.json()
    expect(message).toBe('User with this email already exists')

    expect(await prisma.user.count({ where: { email } })).toBe(1)
  })
})

describe('POST /api/auth/login', () => {
  it('400 when email or password is missing', async () => {
    const res = await login(jsonRequest('http://localhost/api/auth/login', {
      method: 'POST',
      body: { email: 'nopass@test.dev' },
    }))
    expect(res.status).toBe(400)
  })

  it('correct creds return { token, user }', async () => {
    const email = `login-${Date.now()}@test.dev`
    await register(jsonRequest('http://localhost/api/auth/register', {
      method: 'POST',
      body: { email, password: 'password123' },
    }))

    const res = await login(jsonRequest('http://localhost/api/auth/login', {
      method: 'POST',
      body: { email, password: 'password123' },
    }))
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(typeof data.token).toBe('string')
    expect(data.user.email).toBe(email)
  })

  it('401 on wrong password', async () => {
    const email = `wrongpw-${Date.now()}@test.dev`
    await register(jsonRequest('http://localhost/api/auth/register', {
      method: 'POST',
      body: { email, password: 'password123' },
    }))

    const res = await login(jsonRequest('http://localhost/api/auth/login', {
      method: 'POST',
      body: { email, password: 'wrong-password' },
    }))
    expect(res.status).toBe(401)
    const { message } = await res.json()
    expect(message).toBe('Invalid email or password')
  })

  it('401 on unknown email', async () => {
    const res = await login(jsonRequest('http://localhost/api/auth/login', {
      method: 'POST',
      body: { email: 'no-such-user@test.dev', password: 'password123' },
    }))
    expect(res.status).toBe(401)
    const { message } = await res.json()
    expect(message).toBe('Invalid email or password')
  })
})

describe('GET /api/auth/me', () => {
  it('401 without a token', async () => {
    const res = await me(jsonRequest('http://localhost/api/auth/me'))
    expect(res.status).toBe(401)
    const { message } = await res.json()
    expect(message).toBe('Unauthorized')
  })

  it('401 with an invalid token', async () => {
    const res = await me(jsonRequest('http://localhost/api/auth/me', { credential: 'not-a-real-jwt' }))
    expect(res.status).toBe(401)
  })

  it('valid token returns the current user', async () => {
    const { user, org, token } = await createOrgWithUser()
    const res = await me(jsonRequest('http://localhost/api/auth/me', { credential: token }))
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.id).toBe(user.id)
    expect(data.email).toBe(user.email)
    expect(data.organizations).toHaveLength(1)
    expect(data.organizations[0].id).toBe(org.id)
  })
})
