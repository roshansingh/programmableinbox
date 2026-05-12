"use client"

import type * as React from 'react'
import {
  ALL_BLOCK_KEYS,
  blockCatalog,
  type BlockCatalogEntry,
} from '@/lib/automations/block-catalog'

export const AUTOMATION_BLOCK_MIME = 'application/x-automation-block'

export function PaletteSidebar() {
  const entries = ALL_BLOCK_KEYS.map((key) => blockCatalog[key])
  const logicEntries = entries.filter((entry) => entry.group === 'logic')
  const actionEntries = entries.filter((entry) => entry.group === 'action')

  return (
    <aside className="flex w-48 flex-col gap-4 border-r p-3 text-sm">
      <PaletteSection title="Logic" entries={logicEntries} />
      <PaletteSection title="Actions" entries={actionEntries} />
    </aside>
  )
}

function PaletteSection({ title, entries }: { title: string; entries: BlockCatalogEntry[] }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="flex flex-col gap-1">
        {entries.map((entry) => (
          <PaletteItem key={entry.key} entry={entry} />
        ))}
      </div>
    </div>
  )
}

function PaletteItem({ entry }: { entry: BlockCatalogEntry }) {
  const Icon = entry.icon

  function handleDragStart(event: React.DragEvent<HTMLDivElement>) {
    event.dataTransfer.setData(AUTOMATION_BLOCK_MIME, entry.key)
    event.dataTransfer.setData('text/plain', entry.key)
    event.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={handleDragStart}
      data-block-key={entry.key}
      className="flex cursor-grab items-center gap-2 rounded-md border bg-card p-2 text-sm hover:bg-accent active:cursor-grabbing"
    >
      <Icon className="h-4 w-4 flex-shrink-0" />
      <span className="font-medium">{entry.label}</span>
    </div>
  )
}
