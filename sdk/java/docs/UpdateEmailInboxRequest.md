

# UpdateEmailInboxRequest


## Properties

| Name | Type | Description | Notes |
|------------ | ------------- | ------------- | -------------|
|**name** | **String** | The new display label. Subject to the impersonation blocklist, so an inbox cannot be renamed into one. |  [optional] |
|**email** | **String** | Accepted only when it matches the current address. Present so a client can round-trip a full record; any other value is a 409. |  [optional] |



