# ProgrammableInbox Python SDK

[ProgrammableInbox](https://www.programmableinbox.com/) is a secondary inbox built for developers.
Spin up a programmable email address in seconds, and it receives, categorizes, and extracts every
message that arrives — grab a one-time code over the API, route mail with a rule, or read it in
the dashboard. This is a typed client for its REST API.

## Install

```bash
pip install programmableinbox
```

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

The default host is `https://app.programmableinbox.com`; pass `host=` to `Configuration` to point
at a local dev server instead.

## Links

- [ProgrammableInbox](https://www.programmableinbox.com/)
- [API docs](https://app.programmableinbox.com/api-docs)
- [Source](https://github.com/roshansingh/programmableinbox)
