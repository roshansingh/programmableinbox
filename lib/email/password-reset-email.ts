import 'server-only'
import { config, requireEmailVerification } from '@/lib/config'
import { getResend } from '@/lib/resend'
import { signPasswordResetToken } from '@/lib/auth/password-reset-token'
import { formatDuration } from '@/lib/format-duration'

/**
 * Builds the absolute link the reset email carries.
 *
 * The origin comes from `APP_BASE_URL`, never the request — deriving it from
 * `Host` would hand anyone who controls that header the domain shown in the
 * victim's email. The token is the only query parameter: a link that also took
 * a `redirect` would be an open redirect with our sending reputation behind it.
 */
export function buildPasswordResetUrl(token: string): string {
  const { appBaseUrl } = requireEmailVerification()

  const url = new URL('/auth/reset-password', appBaseUrl)
  url.searchParams.set('token', token)
  return url.toString()
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Signs a fresh link and mails it.
 *
 * `passwordHash` is required because the token is bound to it — see `pwh` in
 * lib/auth/password-reset-token.ts. Passing the hash in rather than re-reading
 * the row keeps the binding and the send in one transaction's worth of state.
 *
 * Throws on a Resend failure. The request route catches it and still answers
 * with the same generic success, so a caller cannot tell a send failure from a
 * nonexistent account.
 */
export async function sendPasswordResetEmail(user: {
  id: string
  email: string
  passwordHash: string
}): Promise<void> {
  const token = signPasswordResetToken({
    userId: user.id,
    email: user.email,
    passwordHash: user.passwordHash,
  })
  const url = buildPasswordResetUrl(token)
  const product = config.email.fromName
  const validFor = formatDuration(config.emailVerification.passwordResetTtlMinutes)

  const { error } = await getResend().emails.send({
    from: `${product} <${config.email.from}>`,
    to: user.email,
    subject: `Reset your ${product} password`,
    text: [
      `Reset your ${product} password`,
      '',
      `Someone asked to reset the password for the ${product} account at ${user.email}.`,
      'Open the link below to choose a new one:',
      '',
      url,
      '',
      `The link is valid for ${validFor} and can only be used once.`,
      '',
      'If you did not ask for this, you can ignore this email — your password has not changed and no one can see it.',
    ].join('\n'),
    html: [
      '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#111">',
      `<h1 style="font-size:18px;margin:0 0 16px">Reset your ${escapeHtml(product)} password</h1>`,
      `<p style="margin:0 0 16px">Someone asked to reset the password for the ${escapeHtml(product)} account at <strong>${escapeHtml(user.email)}</strong>. Choose a new one:</p>`,
      `<p style="margin:0 0 16px"><a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;border-radius:6px;text-decoration:none">Choose a new password</a></p>`,
      `<p style="margin:0 0 16px;color:#555">Or paste this into your browser:<br><span style="word-break:break-all">${escapeHtml(url)}</span></p>`,
      `<p style="margin:0 0 16px;color:#555">The link is valid for <strong>${escapeHtml(validFor)}</strong> and can only be used once.</p>`,
      '<p style="margin:0;color:#555">If you did not ask for this, you can ignore this email — your password has not changed and no one can see it.</p>',
      '</div>',
    ].join(''),
  })

  // The Resend SDK reports failures in the response body rather than by
  // throwing, so a caller that only catches would treat a hard bounce as a
  // successful send.
  if (error) {
    throw new Error(`Resend rejected the password reset email: ${error.message}`)
  }
}
