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

describe('RowStore.prismaShim (the two calls enrichMessage makes)', () => {
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
})
