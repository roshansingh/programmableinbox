export class InvalidCursorError extends Error {
  constructor() {
    super('Invalid cursor')
    this.name = 'InvalidCursorError'
  }
}

export interface DecodedCursor {
  createdAt: Date
  epochMs: number
  id: string
}

export function encodeCursor(row: { createdAt: Date | string; id: string }): string {
  const epochMs = new Date(row.createdAt).getTime()
  return Buffer.from(`${epochMs}|${row.id}`, 'utf8').toString('base64url')
}

export function decodeCursor(token: string): DecodedCursor {
  const raw = Buffer.from(token, 'base64url').toString('utf8')
  const sep = raw.indexOf('|')
  if (sep === -1) throw new InvalidCursorError()
  const epochMs = Number(raw.slice(0, sep))
  const id = raw.slice(sep + 1)
  if (!id || !Number.isInteger(epochMs)) throw new InvalidCursorError()
  return { createdAt: new Date(epochMs), epochMs, id }
}
