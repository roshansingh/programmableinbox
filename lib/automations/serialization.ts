import type { AutomationRevision } from '@/lib/generated/prisma/client'
import type { AutomationConfig, AutomationLayout } from './types'
import { migrateAutomationConfig, migrateAutomationLayout } from './migrations'

export function parseAutomationConfig(input: unknown): AutomationConfig {
  return migrateAutomationConfig(input)
}

export function parseAutomationLayout(input: unknown): AutomationLayout {
  return migrateAutomationLayout(input)
}

export function parseRevisionPayload(revision: Pick<AutomationRevision, 'config' | 'layout'>): {
  config: AutomationConfig
  layout: AutomationLayout
} {
  return {
    config: parseAutomationConfig(revision.config),
    layout: parseAutomationLayout(revision.layout),
  }
}
