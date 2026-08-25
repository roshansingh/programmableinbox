# ProgrammableInbox TypeScript SDK

Generated from `lib/openapi/email-inboxes.ts` using `typescript-fetch` (native Fetch API, no axios dependency — works in Node and the browser). Regenerate with `npm run sdk:generate` from the repo root — do not hand-edit anything else in this directory.

## Install

```bash
npm install ./sdk/typescript
```

(From a checkout. The release pipeline that publishes this to npm now exists — see
[`sdk/README.md`](../README.md#publishing) — but publishing is gated on a maintainer bumping the
version in `package.json` and on npm registry provisioning, tracked in
[issue #130](https://github.com/roshansingh/programmableinbox/issues/130); it hasn't happened yet.)

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
