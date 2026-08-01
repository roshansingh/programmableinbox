import { jsonSuccess } from '@/lib/api-helpers'
import { config } from '@/lib/config'
import { prisma } from '@/lib/db'

const TOLERANCES_SECONDS: Record<string, number> = {
  'walg-wal': 10 * 60,
  'walg-base': 26 * 60 * 60,
  'restic-pgdump': 26 * 60 * 60,
  'rclone-mirror': 75 * 60,
}

export async function GET(request?: Request) {
  let dbOk = true
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch {
    dbOk = false
  }

  let rows: { jobName: string; lastSuccessAt: Date }[] = []
  try {
    rows = await prisma.backupStatus.findMany({
      select: { jobName: true, lastSuccessAt: true },
    })
  } catch {
    // If the table doesn't exist yet, leave rows empty; this also covers
    // the case where the DB itself is down (already reflected in dbOk).
  }

  const now = Date.now()
  const backups: Record<string, string> = {}
  const staleJobs: string[] = []

  for (const row of rows) {
    backups[row.jobName] = row.lastSuccessAt.toISOString()
    const tolerance = TOLERANCES_SECONDS[row.jobName]
    if (tolerance !== undefined) {
      const ageSeconds = (now - row.lastSuccessAt.getTime()) / 1000
      if (ageSeconds > tolerance) {
        staleJobs.push(row.jobName)
      }
    }
  }

  const freshnessBreach = staleJobs.length > 0
  const healthy = dbOk && !freshnessBreach
  const healthzSecret = config.security.healthzSecret
  const providedSecret = request?.headers.get('x-healthz-secret')
  const includeDetails = healthzSecret !== null && providedSecret === healthzSecret.reveal()

  if (!includeDetails) {
    return jsonSuccess(
      {
        status: healthy ? 'ok' : 'degraded',
        db: dbOk ? 'ok' : 'error',
      },
      healthy ? 200 : 503,
    )
  }

  return jsonSuccess(
    {
      status: healthy ? 'ok' : 'degraded',
      db: dbOk ? 'ok' : 'error',
      backups,
      freshness_breach: freshnessBreach,
      stale_jobs: staleJobs,
    },
    healthy ? 200 : 503,
  )
}
