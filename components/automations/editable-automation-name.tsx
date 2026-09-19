"use client"

import { useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Pencil } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { MAX_AUTOMATION_NAME_LENGTH } from '@/lib/automations/name'

interface EditableAutomationNameProps {
  name: string
  /**
   * Persists the new (trimmed, non-empty, changed) name. Reject to keep the
   * input open with what the user typed; the caller owns surfacing the error.
   */
  onRename: (name: string) => Promise<void>
}

export function EditableAutomationName({ name, onRename }: EditableAutomationNameProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const [isSaving, setIsSaving] = useState(false)
  // A ref rather than state: Enter and the blur it can trigger arrive before
  // a re-render lands, so `isSaving` would still read false on the second call.
  const isSavingRef = useRef(false)

  function startEditing() {
    setDraft(name)
    setIsEditing(true)
  }

  async function commit() {
    if (isSavingRef.current) return

    const next = draft.trim()
    if (!next || next === name) {
      setIsEditing(false)
      return
    }

    isSavingRef.current = true
    setIsSaving(true)
    try {
      await onRename(next)
      setIsEditing(false)
    } catch {
      // Stay open so the typed name is not lost; the caller has reported why.
    } finally {
      isSavingRef.current = false
      setIsSaving(false)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      void commit()
    } else if (event.key === 'Escape') {
      setIsEditing(false)
    }
  }

  if (!isEditing) {
    return (
      <button
        type="button"
        aria-label="Rename automation"
        title="Rename"
        onClick={startEditing}
        className="group flex max-w-full items-center gap-2 rounded-sm text-left hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="truncate">{name}</span>
        <Pencil className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" />
      </button>
    )
  }

  return (
    <Input
      aria-label="Automation name"
      value={draft}
      maxLength={MAX_AUTOMATION_NAME_LENGTH}
      readOnly={isSaving}
      autoFocus
      autoComplete="off"
      onFocus={(event) => event.target.select()}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => void commit()}
      className="h-10 text-2xl font-semibold md:text-2xl"
    />
  )
}
