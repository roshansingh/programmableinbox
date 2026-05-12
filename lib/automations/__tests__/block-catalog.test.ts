import { describe, expect, it } from 'vitest'
import {
  ALL_BLOCK_KEYS,
  blockCatalog,
  blockCatalogList,
  type BlockKey,
} from '@/lib/automations/block-catalog'
import { actionNodeSchema, conditionNodeSchema } from '@/lib/automations/schemas'

describe('blockCatalog', () => {
  it('exposes exactly the v1 block keys', () => {
    expect(new Set(ALL_BLOCK_KEYS)).toEqual(
      new Set(['condition', 'forward_email', 'send_webhook', 'auto_reply', 'add_tag'])
    )
    expect(ALL_BLOCK_KEYS).toHaveLength(5)
  })

  it('exposes block keys in the deliberate display order (condition first, then actions)', () => {
    expect(ALL_BLOCK_KEYS).toEqual([
      'condition',
      'forward_email',
      'send_webhook',
      'auto_reply',
      'add_tag',
    ])
  })

  it('blockCatalogList contains every catalog entry exactly once', () => {
    const listKeys = blockCatalogList.map((entry) => entry.key)
    expect(new Set(listKeys)).toEqual(new Set(Object.keys(blockCatalog)))
    expect(listKeys).toHaveLength(Object.keys(blockCatalog).length)
  })

  it('blockCatalogList follows ALL_BLOCK_KEYS order', () => {
    expect(blockCatalogList.map((entry) => entry.key)).toEqual(ALL_BLOCK_KEYS)
  })

  it.each<BlockKey>(['condition', 'send_webhook', 'auto_reply', 'add_tag'])(
    'createNode for %s returns a config that parses against its schema',
    (key) => {
      const entry = blockCatalog[key]
      const node = entry.createNode('test_id_1')
      expect(node.id).toBe('test_id_1')

      if (key === 'condition') {
        expect(entry.group).toBe('logic')
        expect(() => conditionNodeSchema.parse(node)).not.toThrow()
      } else {
        expect(entry.group).toBe('action')
        expect(() => actionNodeSchema.parse(node)).not.toThrow()
      }
    }
  )

  it('createNode for forward_email returns a draft config (empty recipients, parse fails on `to` path)', () => {
    const entry = blockCatalog.forward_email
    const node = entry.createNode('test_id_2')
    expect(node.id).toBe('test_id_2')
    expect(entry.group).toBe('action')
    // Per spec: the default `to: []` is deliberately incomplete so the editor
    // surfaces it as a validation error until the user fills it in.
    const result = actionNodeSchema.safeParse(node)
    expect(result.success).toBe(false)
    if (!result.success) {
      const hasRecipientIssue = result.error.issues.some(
        (issue) => issue.path.includes('to') && /recipient/i.test(issue.message)
      )
      expect(hasRecipientIssue).toBe(true)
    }
  })
})
