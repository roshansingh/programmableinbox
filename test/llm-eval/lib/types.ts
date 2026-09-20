import type { ClassifiedLink } from '@/lib/email/cta-heuristic'

export type RunMode = 'withoutLlm' | 'withLlm'
export const RUN_MODES: readonly RunMode[] = ['withoutLlm', 'withLlm']

export type Status = 'pass' | 'fail' | 'generated' | 'skipped'
export type Action = 'compare' | 'generate' | 'skip'

export interface CaseDir {
  /** Path relative to the cases root, with `/` separators. */
  id: string
  dir: string
  /** At least one of `htmlPath` and `textPath` is non-null: that is what makes a folder a case. */
  htmlPath: string | null
  textPath: string | null
  subjectPath: string | null
  intentPath: string | null
  outputPath: string
}

/** The subset of an EmailMessage row that ingestion writes and enrichment reads/writes. */
export interface EvalRow {
  id: string
  organizationId: string
  subject: string
  text: string
  html: string
  bodyText: string | null
  extractedOtp: string | null
  categories: string[]
  metadata: { links: ClassifiedLink[]; timestamps: string[] }
}

/** The stored fields a run is judged on. Ids and processing times are deliberately absent. */
export interface Snapshot {
  extractedOtp: string | null
  categories: string[]
  metadata: { links: ClassifiedLink[]; timestamps: string[] }
}

export interface SectionMeta {
  at: string
  model: string | null
}

export type StoredSection = Snapshot & { _generated?: SectionMeta }

export interface StoredOutput {
  withoutLlm?: StoredSection
  withLlm?: StoredSection
}

export interface Diff {
  path: string
  expected: unknown
  actual: unknown
}

export interface Comparison {
  failures: Diff[]
  informational: Diff[]
}

export interface RunRecord {
  caseId: string
  mode: RunMode
  status: Status
  failures: Diff[]
  informational: Diff[]
  notes: string[]
}
