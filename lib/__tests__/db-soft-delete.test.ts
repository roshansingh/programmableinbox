import { describe, expect, it } from 'vitest'
import {
  applySoftDeleteFilter,
  isSoftDeleteFiltered,
  SOFT_DELETE_MODELS,
} from '../db-soft-delete'

describe('isSoftDeleteFiltered', () => {
  it('filters reads on every soft-deletable model', () => {
    for (const model of SOFT_DELETE_MODELS) {
      expect(isSoftDeleteFiltered(model, 'findMany'), model).toBe(true)
    }
  })

  it.each([
    'findUnique',
    'findUniqueOrThrow',
    'findFirst',
    'findFirstOrThrow',
    'findMany',
    'count',
    'aggregate',
    'groupBy',
  ])('filters the %s read operation', (operation) => {
    expect(isSoftDeleteFiltered('EmailMessage', operation)).toBe(true)
  })

  it('leaves models without a deletedAt column alone', () => {
    // ApiKey tracks its lifecycle with revokedAt, not deletedAt (F5) —
    // injecting deletedAt here would query a column that does not exist.
    expect(isSoftDeleteFiltered('ApiKey', 'findMany')).toBe(false)
    expect(isSoftDeleteFiltered('User', 'findMany')).toBe(false)
    expect(isSoftDeleteFiltered('WebhookEvent', 'findMany')).toBe(false)
  })

  it('does not touch writes', () => {
    // Writes are safe unfiltered because every write route authorizes via a
    // read first, and that read is filtered.
    for (const operation of ['create', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']) {
      expect(isSoftDeleteFiltered('EmailMessage', operation), operation).toBe(false)
    }
  })

  it('ignores an undefined model (raw queries, $transaction)', () => {
    expect(isSoftDeleteFiltered(undefined, 'findMany')).toBe(false)
  })
})

describe('applySoftDeleteFilter', () => {
  it('adds deletedAt: null to a query that has no where at all', () => {
    expect(applySoftDeleteFilter(undefined)).toEqual({ where: { deletedAt: null } })
    expect(applySoftDeleteFilter({})).toEqual({ where: { deletedAt: null } })
  })

  it('preserves the existing where clause', () => {
    expect(applySoftDeleteFilter({ where: { inboxEmailAddressId: 'inbox_1' } })).toEqual({
      where: { inboxEmailAddressId: 'inbox_1', deletedAt: null },
    })
  })

  it('preserves sibling args like orderBy and take', () => {
    const args = { where: { id: 'm_1' }, orderBy: { createdAt: 'desc' }, take: 10 }

    expect(applySoftDeleteFilter(args)).toEqual({
      where: { id: 'm_1', deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })
  })

  it('does not mutate the caller args', () => {
    const args = { where: { id: 'm_1' } }
    applySoftDeleteFilter(args)

    expect(args).toEqual({ where: { id: 'm_1' } })
  })

  it('respects an explicit deletedAt as an escape hatch', () => {
    // How a "this inbox was deleted" view opts in to seeing deleted rows.
    const args = { where: { deletedAt: { not: null } } }

    expect(applySoftDeleteFilter(args)).toEqual(args)
  })

  it('respects an explicit deletedAt: null without duplicating it', () => {
    expect(applySoftDeleteFilter({ where: { deletedAt: null, id: 'm_1' } })).toEqual({
      where: { deletedAt: null, id: 'm_1' },
    })
  })
})
