import { test as base, expect } from '@playwright/test'
import { pibxFixtures, type PibxFixtures } from '../dist/playwright/index.js'

const test = base.extend<PibxFixtures>(pibxFixtures)

test('pibx.otpAfter runs the trigger and returns the code', async ({ pibx }) => {
  let triggered = false
  const { otp } = await pibx.otpAfter(
    () => {
      triggered = true
    },
    { from: 'openai.com', timeoutMs: 5000, pollIntervalMs: 50 },
  )
  expect(triggered).toBe(true)
  expect(otp).toBe('314159')
})
