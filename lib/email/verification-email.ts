import 'server-only'
import { config, requireEmailVerification } from '@/lib/config'
import { getResend } from '@/lib/resend'
import { signVerificationToken } from '@/lib/auth/verification-token'

/**
 * Builds the absolute link a verification email carries (issue #102 §7.5).
 *
 * The origin comes from `APP_BASE_URL`, never from the request — see the
 * `emailVerification` schema in lib/config/schema.ts for why. The token is the
 * only query parameter: an emailed link that also accepted a `redirect` would
 * be an open redirect with our sending domain's reputation behind it.
 */
export function buildVerificationUrl(token: string): string {
  const { appBaseUrl } = requireEmailVerification()

  const url = new URL('/auth/verify', appBaseUrl)
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
 * Signs a fresh link and mails it, through the same Resend client and
 * `config.email` sender the rest of the product sends from.
 *
 * No tracking pixel and no redirect parameter. The product is named in the
 * body and the 24-hour expiry is stated, so the mail does not read as
 * phishing — which matters more than usual for a message whose entire purpose
 * is to get someone to click a link.
 *
 * Throws on a Resend failure; callers decide what that means. For signup it
 * must not fail the request (§7.2); for an explicit resend it must (§7.4).
 */
export async function sendVerificationEmail(user: {
  id: string
  email: string
}): Promise<void> {
  const token = signVerificationToken({ userId: user.id, email: user.email })
  const url = buildVerificationUrl(token)
  const product = config.email.fromName

  const { error } = await getResend().emails.send({
    from: `${product} <${config.email.from}>`,
    to: user.email,
    subject: `Verify your email address for ${product}`,
    text: [
      `Confirm your email address for ${product}`,
      '',
      `You (or someone using this address) created a ${product} account with ${user.email}.`,
      'Open the link below to confirm the address and finish setting up:',
      '',
      url,
      '',
      'The link is valid for 24 hours. If it expires, request a new one from',
      'the app.',
      '',
      "If you did not sign up, you can ignore this email — the account stays",
      'unverified and unusable.',
    ].join('\n'),
    html: [
      '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#111">',
      `<h1 style="font-size:18px;margin:0 0 16px">Confirm your email address for ${escapeHtml(product)}</h1>`,
      `<p style="margin:0 0 16px">You (or someone using this address) created a ${escapeHtml(product)} account with <strong>${escapeHtml(user.email)}</strong>. Confirm the address to finish setting up:</p>`,
      `<p style="margin:0 0 16px"><a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;border-radius:6px;text-decoration:none">Verify email address</a></p>`,
      `<p style="margin:0 0 16px;color:#555">Or paste this into your browser:<br><span style="word-break:break-all">${escapeHtml(url)}</span></p>`,
      '<p style="margin:0 0 16px;color:#555">The link is valid for <strong>24 hours</strong>. If it expires, request a new one from the app.</p>',
      '<p style="margin:0;color:#555">If you did not sign up, you can ignore this email — the account stays unverified and unusable.</p>',
      '</div>',
    ].join(''),
  })

  // The Resend SDK reports failures in the response body rather than by
  // throwing, so a caller that only catches would treat a hard bounce as a
  // successful send — and, on the resend path, stamp a cooldown for an email
  // that never went out.
  if (error) {
    throw new Error(`Resend rejected the verification email: ${error.message}`)
  }
}
