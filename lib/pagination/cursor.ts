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

/** Largest instant `Date` can represent; beyond this `new Date(ms)` is Invalid. */
const MAX_EPOCH_MS = 8_640_000_000_000_000

export function decodeCursor(token: string): DecodedCursor {
  const raw = Buffer.from(token, 'base64url').toString('utf8')
  const sep = raw.indexOf('|')
  if (sep === -1) throw new InvalidCursorError()
  const epochStr = raw.slice(0, sep)
  const id = raw.slice(sep + 1)
  // Digits only: Number() would otherwise accept "1e12", " 12 " and "Infinity".
  if (!id || !/^-?\d+$/.test(epochStr)) {
    throw new InvalidCursorError()
  }
  const epochMs = Number(epochStr)
  // Rejects unsafe integers too — MAX_EPOCH_MS is well below Number.MAX_SAFE_INTEGER.
  if (!Number.isInteger(epochMs) || Math.abs(epochMs) > MAX_EPOCH_MS) {
    throw new InvalidCursorError()
  }
  return { createdAt: new Date(epochMs), epochMs, id }
}
