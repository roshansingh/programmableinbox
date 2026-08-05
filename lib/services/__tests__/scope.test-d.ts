import { expectTypeOf, test } from 'vitest'
import { toOwnerScope, type InboxWriteScope, type OwnerScope } from '../scope'
import { deleteInbox, deleteMessage, setMessageStarred } from '../email-inbox'
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

/**
 * `email_inboxes:write` gives an API key its first mutation. These assert the
 * blast radius of that: create and update, nothing else.
 *
 * Without them, merging `InboxWriteScope` into `OwnerScope` — or widening a
 * delete service to accept either — would compile silently and hand every key
 * holding the write scope the ability to permanently retire an address.
 */
test('an inbox write scope cannot stand in for an owner scope', () => {
  expectTypeOf<InboxWriteScope>().not.toExtend<OwnerScope>()
})

test('deleteInbox is unreachable with an inbox write scope', () => {
  expectTypeOf<InboxWriteScope>().not.toExtend<Parameters<typeof deleteInbox>[0]>()
})

test('message mutations are unreachable with an inbox write scope', () => {
  expectTypeOf<InboxWriteScope>().not.toExtend<Parameters<typeof deleteMessage>[0]>()
  expectTypeOf<InboxWriteScope>().not.toExtend<Parameters<typeof setMessageStarred>[0]>()
})
