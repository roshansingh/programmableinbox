---
sidebar_position: 4
title: TypeScript
---

# TypeScript SDK

```bash
npm install @programmableinbox/sdk
```

```ts
import { Configuration, EmailInboxesApi } from '@programmableinbox/sdk';

const config = new Configuration({ accessToken: 'sk_live_...' });
const api = new EmailInboxesApi(config);

const inboxes = await api.listEmailInboxes();
```

Point at a self-hosted instance by setting `basePath` on the `Configuration`:

```ts
const config = new Configuration({
  accessToken: 'sk_live_...',
  basePath: 'https://your-domain.example.com/api/v1',
});
```

See the [API Reference](../api-reference/authentication-and-scopes) for
every available operation.
