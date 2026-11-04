/**
 * Display form of an E.164 number. North American numbers (`+1` and ten digits)
 * read as `+1 (415) 555-0100`; anything else is shown as stored rather than
 * guessed at. Display only: the E.164 string is what is stored and sent.
 */
export function formatPhoneNumber(e164: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164)
  return match ? `+1 (${match[1]}) ${match[2]}-${match[3]}` : e164
}
