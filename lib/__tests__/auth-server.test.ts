import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import jwt from 'jsonwebtoken'

// auth-server imports the Prisma singleton for its user lookups; none of the
// token tests touch the database, so keep it out of the way.
vi.mock('@/lib/db', () => ({ prisma: {} }))

// The module resolves the secret lazily through @/lib/config, so a single
// import is enough — no resetModules dance required.
import { signToken, verifyToken } from '@/lib/auth-server'
import { resetConfigCache } from '@/lib/config'

const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET

// Config memoizes per domain, so a test that changes JWT_SECRET must clear the
// memo or it reads the previous test's parse.
beforeEach(() => {
  resetConfigCache()
})

afterEach(() => {
  if (ORIGINAL_JWT_SECRET === undefined) {
    delete process.env.JWT_SECRET
  } else {
    process.env.JWT_SECRET = ORIGINAL_JWT_SECRET
  }
  resetConfigCache()
})

describe('auth-server JWT secret handling', () => {
  describe('fails closed when JWT_SECRET is missing', () => {
    beforeEach(() => {
      delete process.env.JWT_SECRET
    })

    it('signToken throws when JWT_SECRET is unset', () => {
      expect(() => signToken({ userId: 'user_1' })).toThrow(/JWT_SECRET/)
    })

    it('verifyToken throws when JWT_SECRET is unset (never silently returns null)', () => {
      expect(() => verifyToken('any.token.value')).toThrow(/JWT_SECRET/)
    })
  })

  describe('rejects unusable secrets', () => {
    it.each([
      ['empty string', ''],
      ['whitespace only', '   '],
      ['tab/newline only', '\t\n'],
    ])('signToken throws when JWT_SECRET is %s', (_label, value) => {
      process.env.JWT_SECRET = value
      expect(() => signToken({ userId: 'user_1' })).toThrow(/JWT_SECRET/)
    })

    it.each([
      ['empty string', ''],
      ['whitespace only', '   '],
    ])('verifyToken throws when JWT_SECRET is %s', (_label, value) => {
      process.env.JWT_SECRET = value
      expect(() => verifyToken('any.token.value')).toThrow(/JWT_SECRET/)
    })
  })

  describe('normal operation with a configured secret', () => {
    beforeEach(() => {
      process.env.JWT_SECRET = 'a-real-secret-for-tests'
    })

    it('round-trips a signed token', () => {
      const token = signToken({ userId: 'user_42' })
      expect(typeof token).toBe('string')
      expect(verifyToken(token)?.userId).toBe('user_42')
    })

    it('sets a 7 day expiry', () => {
      const token = signToken({ userId: 'user_42' })
      const decoded = jwt.decode(token) as { iat: number; exp: number }
      expect(decoded.exp - decoded.iat).toBe(7 * 24 * 60 * 60)
    })

    it('returns null (not throws) for a token signed with a different secret', () => {
      const forged = jwt.sign({ userId: 'attacker' }, 'some-other-secret')
      expect(verifyToken(forged)).toBeNull()
    })

    it('returns null for a garbage token', () => {
      expect(verifyToken('not-a-jwt')).toBeNull()
    })

    it('rejects a validly-signed token that omits iat — the eviction check has nothing to compare otherwise', () => {
      // jwt.sign stamps iat automatically; noTimestamp: true is the only way
      // to produce a token that skips it while still being signed with the
      // real secret, which is exactly the omission verifyToken's comment
      // says would bypass the passwordChangedAt eviction check.
      const noIatToken = jwt.sign({ userId: 'user_42' }, 'a-real-secret-for-tests', {
        noTimestamp: true,
      })
      expect(jwt.decode(noIatToken)).not.toHaveProperty('iat')
      expect(verifyToken(noIatToken)).toBeNull()
    })

    it('is not captured at module load — a first read after import still sees the env', () => {
      // This is the property that keeps `next build` working: auth-server is
      // imported transitively by every protected route, and the build evaluates
      // those modules with no JWT_SECRET present.
      resetConfigCache()
      process.env.JWT_SECRET = 'a-different-real-secret'
      const token = signToken({ userId: 'user_42' })
      expect(jwt.verify(token, 'a-different-real-secret')).toMatchObject({ userId: 'user_42' })
    })

    it('memoizes the secret, so a rotation takes effect only after a restart', () => {
      // Deliberate consequence of memoizing the parsed config: re-reading
      // process.env later must not be able to reintroduce an unvalidated value.
      // In practice nothing is lost — a deployed container cannot see a changed
      // env var without restarting anyway.
      const token = signToken({ userId: 'user_42' })
      process.env.JWT_SECRET = 'rotated-secret-long-enough'
      expect(verifyToken(token)?.userId).toBe('user_42')

      resetConfigCache()
      expect(verifyToken(token)).toBeNull()
    })
  })

  describe('the hardcoded fallback is gone from the codebase', () => {
    const repoRoot = path.resolve(__dirname, '..', '..')

    function sourceFiles(dir: string, acc: string[] = []): string[] {
      const skip = new Set([
        'node_modules',
        '.next',
        '.git',
        'generated',
        '.claude',
        'coverage',
        'dist',
      ])
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') && entry.name !== '.github') continue
        if (skip.has(entry.name)) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          sourceFiles(full, acc)
        } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
          acc.push(full)
        }
      }
      return acc
    }

    it('lib/auth-server.ts does not default JWT_SECRET to a literal', () => {
      const source = fs.readFileSync(path.join(repoRoot, 'lib', 'auth-server.ts'), 'utf8')
      expect(source).not.toMatch(/process\.env\.JWT_SECRET\s*(\|\||\?\?)/)
    })

    it('no source file gives JWT_SECRET a fallback value', () => {
      const offenders = sourceFiles(repoRoot)
        .filter((file) => !file.includes(`${path.sep}__tests__${path.sep}`))
        .filter((file) => {
          const source = fs.readFileSync(file, 'utf8')
          return /process\.env\.JWT_SECRET\s*(\|\||\?\?)/.test(source)
        })
        .map((file) => path.relative(repoRoot, file))

      expect(offenders).toEqual([])
    })
  })
})
