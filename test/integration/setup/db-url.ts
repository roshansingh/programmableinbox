// test/integration/setup/db-url.ts
export interface ParsedTestDbUrl {
  dbName: string
  maintenanceUrl: string
  appUrl: string
}

/**
 * Parse TEST_DATABASE_URL into the pieces the harness needs:
 *  - dbName: the target test database (must look like a test DB)
 *  - maintenanceUrl: same server, `postgres` database, for CREATE/DROP DATABASE
 *  - appUrl: the test URL with `options=-c timezone=UTC` guaranteed present
 */
export function parseTestDbUrl(url: string): ParsedTestDbUrl {
  const u = new URL(url)
  const dbName = u.pathname.replace(/^\//, '')
  if (!dbName) throw new Error('TEST_DATABASE_URL has no database name')

  const maintenance = new URL(url)
  maintenance.pathname = '/postgres'
  maintenance.searchParams.delete('schema')

  const app = new URL(url)
  const opts = app.searchParams.get('options') ?? ''
  if (!/timezone\s*=\s*UTC/i.test(opts)) {
    app.searchParams.set('options', `${opts ? opts + ' ' : ''}-c timezone=UTC`)
  }

  return { dbName, maintenanceUrl: maintenance.toString(), appUrl: app.toString() }
}
