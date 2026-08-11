# ProgrammableInbox Python SDK

Generated from `lib/openapi/email-inboxes.ts`. Regenerate with `npm run sdk:generate` from the repo root — do not hand-edit anything else in this directory.

## Install

```bash
pip install ./sdk/python
```

(From a checkout — PyPI publishing is tracked in [issue #124](https://github.com/roshansingh/programmableinbox/issues/124).)

## Quick start

```python
import programmableinbox
from programmableinbox.api.email_inboxes_api import EmailInboxesApi

configuration = programmableinbox.Configuration(
    access_token="sk_live_...",
)

with programmableinbox.ApiClient(configuration) as api_client:
    api = EmailInboxesApi(api_client)
    inboxes = api.list_email_inboxes()
    print(inboxes.data)
```

The default host is `https://app.programmableinbox.com`; pass `host=` to `Configuration` to point at a local dev server instead.
