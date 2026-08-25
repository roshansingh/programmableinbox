# ProgrammableInbox Python SDK

Generated from `lib/openapi/email-inboxes.ts`. Regenerate with `npm run sdk:generate` from the repo root — do not hand-edit anything else in this directory.

## Install

```bash
pip install ./sdk/python
```

(From a checkout. The release pipeline that publishes this to PyPI now exists — see
[`sdk/README.md`](../README.md#publishing) — but publishing is gated on a maintainer bumping the
version in `pyproject.toml` and on PyPI registry provisioning, tracked in
[issue #130](https://github.com/roshansingh/programmableinbox/issues/130); it hasn't happened yet.)

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
