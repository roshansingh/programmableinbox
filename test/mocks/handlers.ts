import { authHandlers } from './handlers/auth'
import { emailHandlers } from './handlers/emails'
import { phoneHandlers } from './handlers/phones'
import { apiKeyHandlers } from './handlers/api-keys'

export const handlers = [
  ...authHandlers,
  ...emailHandlers,
  ...phoneHandlers,
  ...apiKeyHandlers,
]
