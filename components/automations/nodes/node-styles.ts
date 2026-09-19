/**
 * Border and ring classes shared by the trigger, condition and action blocks.
 * A block with a validation issue is red whether or not it is selected, so
 * selecting it cannot hide the problem; selection then shows as a ring.
 */
export function nodeCardClasses({ selected, invalid }: { selected: boolean; invalid: boolean }) {
  const border = invalid ? 'border-destructive' : selected ? 'border-primary' : 'border-border'
  const ring = invalid && selected ? 'ring-2 ring-primary/40' : ''
  return ['border-2', border, ring].filter(Boolean).join(' ')
}
