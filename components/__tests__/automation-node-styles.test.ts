import { describe, expect, it } from 'vitest'
import { nodeCardClasses } from '@/components/automations/nodes/node-styles'

// Which classes a block gets decides what the user reads off the canvas:
// red means "fix this", the primary colour means "this is selected".
describe('nodeCardClasses', () => {
  it('uses the neutral border for a plain block', () => {
    const classes = nodeCardClasses({ selected: false, invalid: false }).split(' ')

    expect(classes).toContain('border-border')
    expect(classes).not.toContain('border-primary')
    expect(classes).not.toContain('border-destructive')
  })

  it('uses the primary border for a selected valid block', () => {
    const classes = nodeCardClasses({ selected: true, invalid: false }).split(' ')

    expect(classes).toContain('border-primary')
    expect(classes).not.toContain('border-destructive')
  })

  it('uses the red border for an invalid block, selected or not', () => {
    for (const selected of [false, true]) {
      const classes = nodeCardClasses({ selected, invalid: true }).split(' ')

      expect(classes).toContain('border-destructive')
      // Selecting a broken block must not hide that it is broken.
      expect(classes).not.toContain('border-primary')
      expect(classes).not.toContain('border-border')
    }
  })

  it('keeps selection visible on an invalid block with a ring', () => {
    expect(nodeCardClasses({ selected: true, invalid: true }).split(' ')).toContain('ring-primary/40')
    expect(nodeCardClasses({ selected: false, invalid: true }).split(' ')).not.toContain('ring-primary/40')
  })
})
