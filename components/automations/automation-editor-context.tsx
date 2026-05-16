"use client"

import { createContext, useContext } from 'react'
import type { BlockKey } from '@/lib/automations/block-catalog'

export type AutomationEditorContextValue = {
  onPickBlock: (sourceNodeId: string, key: BlockKey) => void
  onDeleteBlock: (nodeId: string) => void
}

const AutomationEditorContext = createContext<AutomationEditorContextValue | null>(null)

export const AutomationEditorContextProvider = AutomationEditorContext.Provider

export function useAutomationEditor(): AutomationEditorContextValue {
  const value = useContext(AutomationEditorContext)
  if (!value) {
    throw new Error('useAutomationEditor must be used inside AutomationEditorContextProvider')
  }
  return value
}
