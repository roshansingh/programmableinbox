// test/integration/setup/global-teardown.ts
import { Client } from 'pg'
import { parseTestDbUrl } from './db-url'

// Named export, called from the teardown function returned by global-setup.ts.
// NOT a globalSetup entry of its own (that would run at startup).
export async function dropTestDb() {
  if (process.env.KEEP_TEST_DB === '1') return
  const raw = process.env.TEST_DATABASE_URL
  if (!raw) return

  const { dbName, maintenanceUrl } = parseTestDbUrl(raw)
  if (!/test/i.test(dbName)) return

  const admin = new Client({ connectionString: maintenanceUrl })
  await admin.connect()
  // Terminate stragglers, then drop.
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [dbName],
  )
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}"`)
  await admin.end()
}
