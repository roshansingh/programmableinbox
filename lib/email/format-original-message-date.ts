const originalMessageDateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
  timeZone: 'UTC',
  timeZoneName: 'short',
})

export function formatOriginalMessageDate(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value

  if (Number.isNaN(date.getTime())) {
    return 'Invalid Date'
  }

  return originalMessageDateFormatter.format(date)
}
