# UpdateEmailInboxRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **str** | The new display label. Subject to the impersonation blocklist, so an inbox cannot be renamed into one. | [optional] 

## Example

```python
from programmableinbox.models.update_email_inbox_request import UpdateEmailInboxRequest

# TODO update the JSON string below
json = "{}"
# create an instance of UpdateEmailInboxRequest from a JSON string
update_email_inbox_request_instance = UpdateEmailInboxRequest.from_json(json)
# print the JSON string representation of the object
print(UpdateEmailInboxRequest.to_json())

# convert the object into a dict
update_email_inbox_request_dict = update_email_inbox_request_instance.to_dict()
# create an instance of UpdateEmailInboxRequest from a dict
update_email_inbox_request_from_dict = UpdateEmailInboxRequest.from_dict(update_email_inbox_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


