import { expectTypeOf, test } from 'vitest'
import { toOwnerScope } from '../scope'
import type { UserPrincipal, ApiKeyPrincipal } from '@/lib/auth/principals'

test('toOwnerScope accepts a user principal', () => {
  expectTypeOf(toOwnerScope).parameter(0).toEqualTypeOf<UserPrincipal>()
})

test('toOwnerScope does not accept an api key principal', () => {
  expectTypeOf(toOwnerScope).parameter(0).not.toEqualTypeOf<ApiKeyPrincipal>()
})

test('an api key principal is not assignable to the toOwnerScope parameter', () => {
  // The equality assertions above are both necessary but neither is sufficient
  // on its own. Widening the parameter to `UserPrincipal | ApiKeyPrincipal`
  // leaves `.not.toEqualTypeOf<ApiKeyPrincipal>()` passing, because a union is
  // still not equal to one of its members — only the positive assertion catches
  // it. This states the guarantee directly: an API key must never be a value
  // this function will accept, so no key can reach a mutating service.
  expectTypeOf<ApiKeyPrincipal>().not.toExtend<Parameters<typeof toOwnerScope>[0]>()
})
