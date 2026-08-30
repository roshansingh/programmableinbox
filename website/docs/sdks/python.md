---
sidebar_position: 2
title: Python
---

# Python SDK

```bash
pip install programmableinbox
```

```python
import programmableinbox
from programmableinbox.api.email_inboxes_api import EmailInboxesApi

configuration = programmableinbox.Configuration(access_token="sk_live_...")

with programmableinbox.ApiClient(configuration) as api_client:
    api = EmailInboxesApi(api_client)
    inboxes = api.list_email_inboxes()
    print(inboxes.data)
```

Point at a self-hosted instance by setting `configuration.host`:

```python
configuration = programmableinbox.Configuration(
    access_token="sk_live_...",
    host="https://docs.example.com/api/v1",
)
```

See the [API Reference](../api-reference/authentication-and-scopes) for
every available operation.
