# ProgrammableInbox TypeScript SDK

[ProgrammableInbox](https://www.programmableinbox.com/) is a secondary inbox built for
developers. Spin up a programmable email address in seconds, and it receives, categorizes, and
extracts every message that arrives — grab a one-time code over the API, route mail with a rule,
or read it in the dashboard. This is a typed client for its REST API, using `typescript-fetch`
(native Fetch API — no axios dependency, works in Node and the browser).

## Install

```bash
npm install @programmableinbox/sdk
```

## Quick start

```ts
import { Configuration, EmailInboxesApi } from '@programmableinbox/sdk'

const config = new Configuration({
  accessToken: 'sk_live_...',
})

const api = new EmailInboxesApi(config)
const inboxes = await api.listEmailInboxes()
console.log(inboxes.data)
```

The default base path is `https://app.programmableinbox.com`; pass `basePath: 'http://localhost:4000'` in the `Configuration` to point at a local dev server instead.

## Links

- [ProgrammableInbox](https://www.programmableinbox.com/)
- [API docs](https://app.programmableinbox.com/api-docs)
- [Source](https://github.com/roshansingh/programmableinbox)
