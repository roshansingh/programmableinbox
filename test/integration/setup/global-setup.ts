// test/integration/setup/global-setup.ts
import { Client } from 'pg'
import { execSync } from 'node:child_process'
import { parseTestDbUrl } from './db-url'

export default async function globalSetup() {
  const raw = process.env.TEST_DATABASE_URL
  if (!raw) throw new Error('TEST_DATABASE_URL is required. See .env.test.example')

  const { dbName, maintenanceUrl, appUrl } = parseTestDbUrl(raw)
  if (!/test/i.test(dbName)) throw new Error(`Refusing: "${dbName}" is not a test database`)

  // Create the database if it does not exist.
  const admin = new Client({ connectionString: maintenanceUrl })
  await admin.connect()
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
  if (exists.rowCount === 0) {
    await admin.query(`CREATE DATABASE "${dbName}"`)
  }
  await admin.end()

  // Apply migrations (includes pgcrypto + partial indexes from the baseline).
  execSync('node node_modules/prisma/build/index.js migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: appUrl },
  })

  // Vitest runs this returned function once, after the whole suite. Teardown
  // MUST be the return value of globalSetup — a second file listed in
  // `globalSetup` would run as another *setup*, not as teardown.
  return async () => {
    const { dropTestDb } = await import('./global-teardown')
    await dropTestDb()
  }
}
