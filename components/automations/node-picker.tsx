"use client"

import { Button } from '@/components/ui/button'
import {
  blockCatalog,
  type BlockCatalogEntry,
  type BlockKey,
} from '@/lib/automations/block-catalog'

export function NodePicker({
  allowedKeys,
  onPick,
}: {
  allowedKeys: BlockKey[]
  onPick: (key: BlockKey) => void
}) {
  const visibleEntries = allowedKeys.map((key) => blockCatalog[key])
  const logicEntries = visibleEntries.filter((entry) => entry.group === 'logic')
  const actionEntries = visibleEntries.filter((entry) => entry.group === 'action')

  return (
    <div className="flex flex-col gap-3 p-3">
      {logicEntries.length > 0 ? (
        <PickerGroup title="Logic" entries={logicEntries} onPick={onPick} />
      ) : null}
      {actionEntries.length > 0 ? (
        <PickerGroup title="Actions" entries={actionEntries} onPick={onPick} />
      ) : null}
    </div>
  )
}

function PickerGroup({
  title,
  entries,
  onPick,
}: {
  title: string
  entries: BlockCatalogEntry[]
  onPick: (key: BlockKey) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {entries.map((entry) => {
        const Icon = entry.icon
        return (
          <Button
            key={entry.key}
            type="button"
            variant="ghost"
            className="h-auto justify-start gap-2 px-2 py-1.5 text-left"
            onClick={() => onPick(entry.key)}
          >
            <Icon className="h-4 w-4 flex-shrink-0" />
            <div className="flex flex-col">
              <div className="text-sm font-medium leading-none">{entry.label}</div>
              <div className="text-xs text-muted-foreground">{entry.description}</div>
            </div>
          </Button>
        )
      })}
    </div>
  )
}
