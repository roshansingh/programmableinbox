

# CreateEmailInboxRequest


## Properties

| Name | Type | Description | Notes |
|------------ | ------------- | ------------- | -------------|
|**email** | **String** | The address to claim. Normalized to lowercase before storage, and permanent once created. |  |
|**name** | **String** | Optional display label. Subject to the same impersonation blocklist as the address. |  [optional] |
|**organizationId** | **String** | Optional. Must match the organization the API key is bound to if supplied; the key&#39;s organization is used otherwise. |  [optional] |



