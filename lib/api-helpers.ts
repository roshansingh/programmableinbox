import { NextResponse } from 'next/server'

export function jsonSuccess(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status })
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ message }, { status })
}

/**
 * True when `error` is Prisma's unique-constraint violation (P2002) for a
 * given column.
 *
 * The affected column(s) show up in two different shapes depending on
 * driver: `meta.target` (array or bare string) for the standard query
 * engine, or `meta.driverAdapterError.cause.constraint.fields` (array) when
 * running through `@prisma/adapter-pg` (this project's setup — see
 * `lib/db.ts`). Both are checked so this works regardless of driver.
 */
export function isUniqueViolation(error: unknown, field: string): boolean {
  if (typeof error !== 'object' || error === null) return false

  const { code, meta } = error as {
    code?: unknown
    meta?: {
      target?: unknown
      driverAdapterError?: { cause?: { constraint?: { fields?: unknown } } }
    }
  }
  if (code !== 'P2002') return false

  const target = meta?.target
  if (Array.isArray(target)) return target.includes(field)
  if (target === field) return true

  const adapterFields = meta?.driverAdapterError?.cause?.constraint?.fields
  return Array.isArray(adapterFields) && adapterFields.includes(field)
}
