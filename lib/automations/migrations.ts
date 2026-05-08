import {
  AUTOMATION_LAYOUT_TYPE,
  AUTOMATION_LAYOUT_VERSION,
  AUTOMATION_SCHEMA_VERSION,
  type AutomationConfig,
  type AutomationLayout,
} from './types'
import { automationConfigSchema, automationLayoutSchema } from './schemas'

export function migrateAutomationConfig(input: unknown): AutomationConfig {
  const parsed = automationConfigSchema.parse(input) as AutomationConfig
  if (parsed.version !== AUTOMATION_SCHEMA_VERSION) {
    throw new Error(`Unsupported automation config version: ${parsed.version}`)
  }
  return parsed
}

export function migrateAutomationLayout(input: unknown): AutomationLayout {
  if (!input) {
    return {
      type: AUTOMATION_LAYOUT_TYPE,
      version: AUTOMATION_LAYOUT_VERSION,
      positions: {},
    }
  }

  const parsed = automationLayoutSchema.parse(input) as AutomationLayout
  if (parsed.version !== AUTOMATION_LAYOUT_VERSION) {
    throw new Error(`Unsupported automation layout version: ${parsed.version}`)
  }
  return parsed
}
