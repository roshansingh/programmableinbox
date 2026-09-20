import { formatDiff } from './compare'
import { RUN_MODES } from './types'
import type { RunMode, RunRecord, Status } from './types'

export class Report {
  private records: RunRecord[] = []
  private baselineNotes: Array<{ caseId: string; unstable: string[]; intent: string[] }> = []

  record(record: RunRecord): void {
    this.records.push(record)
  }

  /** Facts about a case's stored baseline. Purely informational: never affects a status or the exit code. */
  recordBaseline(caseId: string, notes: { unstable: string[]; intent: string[] }): void {
    this.baselineNotes.push({ caseId, ...notes })
  }

  hasFailures(): boolean {
    return this.records.some((record) => record.status === 'fail')
  }

  counts(mode: RunMode): Record<Status, number> {
    const counts: Record<Status, number> = { pass: 0, fail: 0, generated: 0, skipped: 0 }
    for (const record of this.records) {
      if (record.mode === mode) counts[record.status] += 1
    }
    return counts
  }

  render(): string {
    const lines = ['', 'LLM eval — email extraction', '===========================']
    if (this.records.length === 0) {
      lines.push('No cases ran.', '')
      return lines.join('\n')
    }

    lines.push('', 'Per case')
    const caseIds = [...new Set(this.records.map((record) => record.caseId))]
    const width = Math.max(...caseIds.map((id) => id.length))
    for (const id of caseIds) {
      const cells = RUN_MODES.map((mode) => {
        const found = this.records.find((record) => record.caseId === id && record.mode === mode)
        return `${mode} ${found ? found.status.toUpperCase() : '-'}`
      })
      lines.push(`  ${id.padEnd(width)}  ${cells.join('   ')}`)
    }

    lines.push('', 'Totals')
    for (const mode of RUN_MODES) {
      const c = this.counts(mode)
      lines.push(
        `  ${mode.padEnd(10)}  ${c.pass} pass · ${c.fail} fail · ${c.generated} generated · ${c.skipped} skipped`,
      )
    }

    // FAIL and GENERATED always get details. A PASS gets a block only when it
    // has informational diffs or warnings (printed, never failing) — and then
    // only those, not its notes.
    const detailed = this.records.filter(
      (record) =>
        record.status === 'fail' ||
        record.status === 'generated' ||
        record.informational.length > 0 ||
        (record.warnings?.length ?? 0) > 0,
    )
    if (detailed.length > 0) {
      lines.push('', 'Details')
      for (const record of detailed) {
        const showNotes = record.status === 'fail' || record.status === 'generated'
        lines.push(`${record.status.toUpperCase()}  ${record.caseId} [${record.mode}]`)
        for (const diff of record.failures) lines.push(`    ${formatDiff(diff)}`)
        for (const diff of record.informational) lines.push(`    (informational) ${formatDiff(diff)}`)
        for (const warning of record.warnings ?? []) lines.push(`    (warning) ${warning}`)
        if (showNotes) for (const note of record.notes) lines.push(`    ${note}`)
      }
    }

    const unstable = this.baselineNotes.filter((entry) => entry.unstable.length > 0)
    if (unstable.length > 0) {
      lines.push('', 'Unstable baselines (the model gave more than one answer while the baseline was generated)')
      for (const entry of unstable) lines.push(`  ${entry.caseId}: ${entry.unstable.join(', ')}`)
    }

    const disagreements = this.baselineNotes.filter((entry) => entry.intent.length > 0)
    if (disagreements.length > 0) {
      lines.push('', 'Baseline vs intent (informational; never fails a run)')
      for (const entry of disagreements) {
        lines.push(`  ${entry.caseId}`)
        for (const line of entry.intent) lines.push(`    ${line}`)
      }
    }

    const skipped = this.records.filter((record) => record.status === 'skipped')
    if (skipped.length > 0) {
      lines.push('', `Skipped ${skipped.length} run(s): ${skipped[0].notes[0] ?? 'see notes'}`)
    }

    if (this.records.some((record) => record.status === 'generated')) {
      lines.push(
        '',
        'Generated output.json files need a human review: correct any wrong values, then commit them.',
      )
    }

    lines.push('')
    return lines.join('\n')
  }
}
