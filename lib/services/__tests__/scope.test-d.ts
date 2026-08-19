import { expectTypeOf, test } from 'vitest'
import {
  toOwnerScope,
  toMessageReadScope,
  type InboxDeleteScope,
  type InboxWriteScope,
  type MessageReadScope,
  type OrgScope,
  type OwnerScope,
} from '../scope'
import {
  createInbox,
  deleteInbox,
  deleteMessage,
  setMessageRead,
  setMessageStarred,
  updateInboxForWrite,
} from '../email-inbox'
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

/**
 * Deletion is the one operation on the external surface that cannot be undone:
 * the row soft-deletes and is recoverable, but `EmailInbox.email` is a plain
 * unique index, so the address is retired permanently.
 *
 * `email_inboxes:delete` is therefore a scope of its own, and so is its type.
 * These assertions are what stop the three inbox scopes collapsing back into
 * one shape — which would compile silently and let a handler that resolved
 * "may create" reach `deleteInbox`.
 */
test('an inbox write scope cannot delete', () => {
  expectTypeOf<InboxWriteScope>().not.toExtend<Parameters<typeof deleteInbox>[0]>()
})

test('an inbox delete scope cannot create or update', () => {
  expectTypeOf<InboxDeleteScope>().not.toExtend<Parameters<typeof createInbox>[0]>()
  expectTypeOf<InboxDeleteScope>().not.toExtend<Parameters<typeof updateInboxForWrite>[0]>()
})

test('an inbox delete scope still cannot touch messages', () => {
  expectTypeOf<InboxDeleteScope>().not.toExtend<Parameters<typeof deleteMessage>[0]>()
  expectTypeOf<InboxDeleteScope>().not.toExtend<Parameters<typeof setMessageStarred>[0]>()
})

test('an inbox delete scope is not an owner scope', () => {
  expectTypeOf<InboxDeleteScope>().not.toExtend<OwnerScope>()
})

/**
 * `MessageReadScope` (issue #138) is organization-wide, like `OrgScope` — but
 * unlike `OrgScope`, an `ApiKeyPrincipal` must never be able to produce one,
 * since the messages PATCH route it feeds is dashboard-only. These pin both
 * halves of that guarantee: the constructor's parameter type, and that the
 * two same-shaped scopes cannot stand in for each other.
 */
test('toMessageReadScope accepts a user principal', () => {
  expectTypeOf(toMessageReadScope).parameter(0).toEqualTypeOf<UserPrincipal>()
})

test('toMessageReadScope does not accept an api key principal', () => {
  expectTypeOf(toMessageReadScope).parameter(0).not.toEqualTypeOf<ApiKeyPrincipal>()
})

test('an api key principal is not assignable to the toMessageReadScope parameter', () => {
  expectTypeOf<ApiKeyPrincipal>().not.toExtend<Parameters<typeof toMessageReadScope>[0]>()
})

test('an org scope cannot stand in for a message read scope, despite the identical organizationIds field', () => {
  // OrgScope is producible from an ApiKeyPrincipal; MessageReadScope must not
  // be reachable that way even structurally. The required (non-optional)
  // `__scope` discriminant is what keeps OrgScope — which carries no
  // `__scope` at all — from satisfying this type.
  expectTypeOf<OrgScope>().not.toExtend<MessageReadScope>()
})

test('setMessageRead is unreachable with an owner scope', () => {
  expectTypeOf<OwnerScope>().not.toExtend<Parameters<typeof setMessageRead>[0]>()
})

test('setMessageStarred is unreachable with a message read scope', () => {
  expectTypeOf<MessageReadScope>().not.toExtend<Parameters<typeof setMessageStarred>[0]>()
})

test('deleteMessage is unreachable with a message read scope', () => {
  expectTypeOf<MessageReadScope>().not.toExtend<Parameters<typeof deleteMessage>[0]>()
})
