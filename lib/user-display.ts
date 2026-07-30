/**
 * Display helpers for rendering a user's name/initials in the UI, and for
 * deriving the default organization name at registration time.
 *
 * Kept free of framework imports so both route handlers and client components
 * can use it.
 */

export interface DisplayableUser {
  email: string
  firstName?: string | null
  lastName?: string | null
}

function clean(value?: string | null): string {
  return (value ?? '').trim()
}

function emailLocalPart(email?: string | null): string {
  return clean(email).split('@')[0] ?? ''
}

/** Full name when available, otherwise the email local part. */
export function getUserDisplayName(user?: DisplayableUser | null): string {
  if (!user) return ''
  const fullName = [clean(user.firstName), clean(user.lastName)].filter(Boolean).join(' ')
  return fullName || emailLocalPart(user.email)
}

/** Up to two uppercase initials for the avatar circle. */
export function getUserInitials(user?: DisplayableUser | null): string {
  if (!user) return ''
  const first = clean(user.firstName)
  const last = clean(user.lastName)

  if (first && last) return (first[0] + last[0]).toUpperCase()

  const source = first || last || emailLocalPart(user.email)
  return source.slice(0, 2).toUpperCase()
}

/**
 * Name for the organization created alongside a new user account.
 * Defaults to the user's own name so the sidebar reads as theirs from day one.
 */
export function defaultOrganizationName(
  firstName?: string | null,
  lastName?: string | null,
  email?: string | null
): string {
  const fullName = [clean(firstName), clean(lastName)].filter(Boolean).join(' ')
  return fullName || emailLocalPart(email) || 'My Organization'
}
