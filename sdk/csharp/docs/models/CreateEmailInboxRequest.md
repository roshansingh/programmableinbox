# ProgrammableInbox.Sdk.Model.CreateEmailInboxRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Email** | **string** | The address to claim. Normalized to lowercase before storage, and permanent once created. | 
**Name** | **string** | Optional display label. Subject to the same impersonation blocklist as the address. | [optional] 
**OrganizationId** | **string** | Optional. Must match the organization the API key is bound to if supplied; the key&#39;s organization is used otherwise. | [optional] 

[[Back to Model list]](../../README.md#documentation-for-models) [[Back to API list]](../../README.md#documentation-for-api-endpoints) [[Back to README]](../../README.md)

