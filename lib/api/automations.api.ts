import { apiClient } from '../api-client'
import type { AutomationConfig, AutomationFlowEdge, AutomationFlowNode, AutomationLayout } from '@/lib/automations/types'

export interface AutomationRevisionSummary {
  id: string
  revision: number
  schemaVersion: number
  createdAt: string
  isActive: boolean
}

export interface AutomationRecord {
  id: string
  organizationId: string
  inboxId: string | null
  name: string
  description: string | null
  isActive: boolean
  status: 'active' | 'draft'
  activeRevisionId: string | null
  activeRevisionNumber: number | null
  schemaVersion: number | null
  canStart: boolean
  config: AutomationConfig | null
  layout: AutomationLayout | null
  nodes: AutomationFlowNode[]
  edges: AutomationFlowEdge[]
  revisions: AutomationRevisionSummary[]
  createdAt: string
  updatedAt: string
}

export interface AutomationRunRecord {
  id: string
  status: string
  triggerType: string
  isDryRun: boolean
  emailMessageId: string | null
  startedAt: string
  finishedAt: string | null
  nodeRuns: Array<{
    id: string
    configNodeId: string
    configNodeType: string
    status: string
    branchTaken: string | null
    startedAt: string
    finishedAt: string | null
  }>
}

export async function getAutomations(params?: { organizationId?: string }) {
  const queryParams = new URLSearchParams()
  if (params?.organizationId) queryParams.append('organizationId', params.organizationId)
  const query = queryParams.toString()
  return apiClient.get<AutomationRecord[]>(`/v1/automations${query ? `?${query}` : ''}`)
}

export async function getAutomation(id: string) {
  return apiClient.get<AutomationRecord>(`/v1/automations/${id}`)
}

export async function createAutomation(data: {
  organizationId: string
  inboxId?: string | null
  name: string
  description?: string | null
  config?: AutomationConfig
  layout?: AutomationLayout
}) {
  return apiClient.post<AutomationRecord>('/v1/automations', data)
}

export async function updateAutomation(
  id: string,
  data: Partial<{
    name: string
    description: string | null
    isActive: boolean
    config: AutomationConfig
    layout: AutomationLayout
  }>
) {
  return apiClient.patch<AutomationRecord>(`/v1/automations/${id}`, data)
}

export async function deleteAutomation(id: string) {
  return apiClient.delete<void>(`/v1/automations/${id}`)
}

export async function activateAutomationRevision(id: string, revisionId: string) {
  return apiClient.post<AutomationRecord>(`/v1/automations/${id}/activate-revision`, { revisionId })
}

export async function duplicateAutomation(id: string) {
  return apiClient.post<AutomationRecord>(`/v1/automations/${id}/duplicate`)
}

export async function dryRunAutomation(id: string, limit = 10) {
  return apiClient.post<Array<{ matched: boolean; status: string; runId: string }>>(
    `/v1/automations/${id}/dry-run`,
    { limit }
  )
}

export async function getAutomationRuns(id: string) {
  return apiClient.get<AutomationRunRecord[]>(`/v1/automations/${id}/runs`)
}

export type AutomationReplayMode = 'dry_run' | 'live'

export interface AutomationReplayResult {
  matched: boolean
  status: string
  runId: string
  mode: AutomationReplayMode
  isDryRun: boolean
}

/**
 * Replays a run. Dry run by default — a live replay re-executes the run's real
 * side effects (outbound webhooks, forwarded email, auto-replies) and therefore
 * has to send an explicit confirmation the server checks (issue #40).
 */
export async function replayAutomationRun(
  id: string,
  runId: string,
  mode: AutomationReplayMode = 'dry_run'
) {
  const body =
    mode === 'live' ? { mode: 'live' as const, confirm: true as const } : { mode: 'dry_run' as const }
  return apiClient.post<AutomationReplayResult>(`/v1/automations/${id}/runs/${runId}/replay`, body)
}
