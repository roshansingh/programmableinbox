import { defineConfig } from 'cypress'
import { pibxTasks } from '../dist/cypress/index.js'

export default defineConfig({
  e2e: {
    specPattern: 'e2e/cypress/e2e/**/*.cy.ts',
    supportFile: 'e2e/cypress/support/e2e.ts',
    video: false,
    screenshotOnRunFailure: false,
    setupNodeEvents(on, config) {
      // Same shape a user gets: cypress.env.json / CYPRESS_* land in config.env.
      config.env.PIBX_API_KEY = process.env.PIBX_API_KEY
      config.env.PIBX_BASE_URL = process.env.PIBX_BASE_URL
      config.env.PIBX_INBOX_ID = process.env.PIBX_INBOX_ID
      pibxTasks(on, config)
      return config
    },
  },
})
