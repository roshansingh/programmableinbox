import { markStuckAutomationRuns } from './dispatcher'

export async function sweepStuckAutomationRuns(maxAgeMinutes = 15) {
  const staleBefore = new Date(Date.now() - maxAgeMinutes * 60 * 1000)
  return markStuckAutomationRuns(staleBefore)
}
