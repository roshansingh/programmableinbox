import { expectTypeOf, test } from 'vitest'
import { toOwnerScope } from '../scope'
import type { UserPrincipal, ApiKeyPrincipal } from '@/lib/auth/principals'

test('toOwnerScope accepts a user principal', () => {
  expectTypeOf(toOwnerScope).parameter(0).toEqualTypeOf<UserPrincipal>()
})

test('toOwnerScope does not accept an api key principal', () => {
  expectTypeOf(toOwnerScope).parameter(0).not.toEqualTypeOf<ApiKeyPrincipal>()
})
