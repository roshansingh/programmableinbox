# CreateEmailInboxRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**email** | **str** | The address to claim. Normalized to lowercase before storage, and permanent once created. | 
**name** | **str** | Optional display label. Subject to the same impersonation blocklist as the address. | [optional] 
**organization_id** | **str** | Optional. Must match the organization the API key is bound to if supplied; the key&#39;s organization is used otherwise. | [optional] 

## Example

```python
from programmableinbox.models.create_email_inbox_request import CreateEmailInboxRequest

# TODO update the JSON string below
json = "{}"
# create an instance of CreateEmailInboxRequest from a JSON string
create_email_inbox_request_instance = CreateEmailInboxRequest.from_json(json)
# print the JSON string representation of the object
print(CreateEmailInboxRequest.to_json())

# convert the object into a dict
create_email_inbox_request_dict = create_email_inbox_request_instance.to_dict()
# create an instance of CreateEmailInboxRequest from a dict
create_email_inbox_request_from_dict = CreateEmailInboxRequest.from_dict(create_email_inbox_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


