import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startStub } from '../test-support/stub-server.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// The OTP route plays a mailbox: the first request (the server-time lookup)
// sees nothing yet; the next ones see a code created *after* that time.
let calls = 0
const stub = await startStub({
  'GET /api/v1/emailInbox/inbx_e2e/otp': (_req, url) => {
    calls++
    if (calls % 2 === 1 && url.searchParams.get('withinMinutes') === '1') {
      return { status: 404, body: { message: 'No OTP' } }
    }
    return {
      status: 200,
      body: {
        data: {
          otp: '314159',
          message: {
            id: 'm',
            subject: 'Your code',
            from: 'noreply@openai.com',
            extractedOtp: '314159',
            createdAt: new Date(Date.now() + 60_000).toISOString(),
          },
        },
      },
    }
  },
})

const env = {
  ...process.env,
  PIBX_API_KEY: 'sk_live_e2e',
  PIBX_BASE_URL: stub.url,
  PIBX_INBOX_ID: 'inbx_e2e',
}

let failed = false
for (const [label, args] of [
  ['cypress', ['cypress', 'run', '--config-file', 'e2e/cypress.config.ts']],
  ['playwright', ['playwright', 'test', '-c', 'e2e/playwright.config.ts']],
]) {
  console.log(`\n==> ${label}`)
  // Async spawn, not spawnSync: the stub server lives in this process, and a
  // blocked event loop could not answer the requests the framework makes.
  const code = await new Promise((resolve) => {
    spawn('npx', args, { cwd: root, env, stdio: 'inherit' }).on('exit', resolve)
  })
  if (code !== 0) failed = true
}
await stub.close()
process.exit(failed ? 1 : 0)
