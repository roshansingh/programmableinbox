import { beforeEach, describe, expect, it } from 'vitest'
import { RowStore } from './row-store'
import type { EvalRow } from './types'

const row = (id = 'r1'): EvalRow => ({
  id,
  organizationId: 'eval-org',
  subject: 's',
  text: '',
  html: '<p>x</p>',
  bodyText: 'x',
  extractedOtp: null,
  categories: [],
  metadata: { links: [], timestamps: [] },
})

let store: RowStore

beforeEach(() => {
  store = new RowStore()
})

describe('RowStore', () => {
  it('stores a copy: mutating the inserted object or a returned row does not change the store', () => {
    const original = row()
    store.insert(original)
    original.categories.push('Spam')
    store.get('r1')!.categories.push('Spam')

    expect(store.get('r1')!.categories).toEqual([])
  })

  it('returns undefined for an unknown id and clears everything on clear()', () => {
    expect(store.get('nope')).toBeUndefined()

    store.insert(row())
    store.clear()

    expect(store.get('r1')).toBeUndefined()
  })
})

describe('RowStore.prismaShim (the calls enrichMessage makes)', () => {
  it('findUnique returns the row, or null when it does not exist', async () => {
    store.insert(row())
    const { emailMessage } = store.prismaShim()

    expect((await emailMessage.findUnique({ where: { id: 'r1' } }))?.subject).toBe('s')
    expect(await emailMessage.findUnique({ where: { id: 'nope' } })).toBeNull()
  })

  it('update merges only the provided fields and leaves the rest', async () => {
    store.insert(row())
    const { emailMessage } = store.prismaShim()

    await emailMessage.update({
      where: { id: 'r1' },
      data: { categories: ['Security'], extractedOtp: '483920' },
    })

    const updated = store.get('r1')!
    expect(updated.categories).toEqual(['Security'])
    expect(updated.extractedOtp).toBe('483920')
    expect(updated.subject).toBe('s')
    expect(updated.bodyText).toBe('x')
  })

  it('update on an unknown id throws, like Prisma would', async () => {
    const { emailMessage } = store.prismaShim()

    await expect(emailMessage.update({ where: { id: 'nope' }, data: {} })).rejects.toThrow(/no row with id nope/)
  })

  it('updateMany writes only the rows that match every filter, and reports how many', async () => {
    store.insert(row('r1'))
    store.insert({ ...row('r2'), extractedOtp: '111111' })
    const { emailMessage } = store.prismaShim()

    const result = await emailMessage.updateMany({
      where: { extractedOtp: null },
      data: { extractedOtp: '222222' },
    })

    expect(result).toEqual({ count: 1 })
    expect(store.get('r1')!.extractedOtp).toBe('222222')
    expect(store.get('r2')!.extractedOtp).toBe('111111')
  })

  it('updateMany guarded on extractedOtp being null never replaces a code that is already stored', async () => {
    // This is the write enrichMessage uses for a recovered OTP: "store it only while it is still null".
    store.insert({ ...row('r1'), extractedOtp: '654321' })
    const { emailMessage } = store.prismaShim()

    const result = await emailMessage.updateMany({
      where: { id: 'r1', extractedOtp: null },
      data: { extractedOtp: '999999' },
    })

    expect(result).toEqual({ count: 0 })
    expect(store.get('r1')!.extractedOtp).toBe('654321')
  })

  it('updateMany refuses a filter it cannot model instead of quietly matching the wrong rows', async () => {
    store.insert(row())
    const { emailMessage } = store.prismaShim()

    await expect(
      emailMessage.updateMany({ where: { extractedOtp: { not: null } }, data: {} }),
    ).rejects.toThrow(/only supports equality filters/)
  })

  it('$transaction settles the operations together and returns their results in order', async () => {
    store.insert(row())
    const { emailMessage, $transaction } = store.prismaShim()

    const results = await $transaction([
      emailMessage.update({ where: { id: 'r1' }, data: { categories: ['Security'] } }),
      emailMessage.updateMany({ where: { id: 'r1', extractedOtp: null }, data: { extractedOtp: '483920' } }),
    ])

    expect(results).toHaveLength(2)
    expect(results[1]).toEqual({ count: 1 })
    expect(store.get('r1')!.categories).toEqual(['Security'])
    expect(store.get('r1')!.extractedOtp).toBe('483920')
  })

  it('$transaction rejects when any operation rejects', async () => {
    store.insert(row())
    const { emailMessage, $transaction } = store.prismaShim()

    await expect(
      $transaction([Promise.resolve(1), emailMessage.update({ where: { id: 'nope' }, data: {} })]),
    ).rejects.toThrow(/no row with id nope/)
  })

  it('$transaction only supports the array form, and says so for the callback form', async () => {
    const { $transaction } = store.prismaShim()

    await expect($transaction(async () => undefined)).rejects.toThrow(/array form/)
  })
})
