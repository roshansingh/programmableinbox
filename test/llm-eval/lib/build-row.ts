import path from 'node:path'
import { deriveIngestionFields } from '@/lib/email/derive-ingestion-fields'
import type { EvalRow, Snapshot } from './types'

export const EVAL_ORGANIZATION_ID = 'eval-org'

const TITLE = /<title[^>]*>([\s\S]*?)<\/title>/i
const NAMED_ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (match, code: string) => {
      const point = Number(code)
      return point <= 0x10ffff ? String.fromCodePoint(point) : match
    })
    .replace(/&(lt|gt|quot|apos|nbsp);/g, (_, name: string) => NAMED_ENTITIES[name])
    .replace(/&amp;/g, '&')
}

/**
 * The email has no envelope in this harness — only `email.html` — so the
 * subject the LLM is shown comes from the document's <title>, falling back to
 * the caller-supplied name (the case folder).
 */
export function deriveSubject(html: string, fallback: string): string {
  const match = TITLE.exec(html)
  const title = match ? decodeEntities(match[1]).replace(/\s+/g, ' ').trim() : ''
  return title || fallback
}

/**
 * The row live ingestion would have created for this email, using the same
 * shared extraction (`deriveIngestionFields`) the webhook route uses. The
 * email is HTML-only: there is no text part, exactly like HTML-only mail.
 */
export function buildRow(input: { id: string; caseId: string; html: string }): EvalRow {
  const { bodyText, extractedOtp, links } = deriveIngestionFields({ text: '', html: input.html })
  return {
    id: input.id,
    organizationId: EVAL_ORGANIZATION_ID,
    subject: deriveSubject(input.html, path.posix.basename(input.caseId)),
    text: '',
    html: input.html,
    bodyText,
    extractedOtp,
    categories: [],
    metadata: { links, timestamps: [] },
  }
}

export function toSnapshot(row: EvalRow): Snapshot {
  return {
    extractedOtp: row.extractedOtp,
    categories: [...row.categories],
    metadata: {
      links: row.metadata.links.map((link) => ({ ...link })),
      timestamps: [...row.metadata.timestamps],
    },
  }
}
