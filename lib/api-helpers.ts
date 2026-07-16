import { NextResponse } from 'next/server'

export function jsonSuccess(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status })
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ message }, { status })
}

/**
 * True when `error` is Prisma's unique-constraint violation (P2002) for a
 * given column. `meta.target` holds the constraint's columns — an array for
 * composite constraints, a bare string for some drivers.
 */
export function isUniqueViolation(error: unknown, field: string): boolean {
  if (typeof error !== 'object' || error === null) return false

  const { code, meta } = error as { code?: unknown; meta?: { target?: unknown } }
  if (code !== 'P2002') return false

  const target = meta?.target
  if (Array.isArray(target)) return target.includes(field)
  return target === field
}
