import { authHandlers } from './handlers/auth'
import { emailHandlers } from './handlers/emails'
import { phoneHandlers } from './handlers/phones'
import { apiKeyHandlers } from './handlers/api-keys'
import { accountHandlers } from './handlers/account'

export const handlers = [
  ...authHandlers,
  ...emailHandlers,
  ...phoneHandlers,
  ...apiKeyHandlers,
  ...accountHandlers,
]
