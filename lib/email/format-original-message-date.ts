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

export function formatOriginalMessageDate(value: Date): string {
  return originalMessageDateFormatter.format(value)
}
