/**
 * Renders a whole number of minutes as prose for user-facing copy.
 *
 * Imports nothing on purpose: the email senders are server-only, but this is
 * the kind of helper a client component reaches for eventually, and a
 * dependency here would drag Pino into the browser bundle.
 */
export function formatDuration(minutes: number): string {
  if (minutes % 1440 === 0) {
    const days = minutes / 1440
    return `${days} ${days === 1 ? 'day' : 'days'}`
  }

  if (minutes % 60 === 0) {
    const hours = minutes / 60
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
  }

  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
}
