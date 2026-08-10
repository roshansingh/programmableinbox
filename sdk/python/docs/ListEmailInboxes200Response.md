# ListEmailInboxes200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | [**List[EmailInbox]**](EmailInbox.md) |  | 

## Example

```python
from programmableinbox.models.list_email_inboxes200_response import ListEmailInboxes200Response

# TODO update the JSON string below
json = "{}"
# create an instance of ListEmailInboxes200Response from a JSON string
list_email_inboxes200_response_instance = ListEmailInboxes200Response.from_json(json)
# print the JSON string representation of the object
print(ListEmailInboxes200Response.to_json())

# convert the object into a dict
list_email_inboxes200_response_dict = list_email_inboxes200_response_instance.to_dict()
# create an instance of ListEmailInboxes200Response from a dict
list_email_inboxes200_response_from_dict = ListEmailInboxes200Response.from_dict(list_email_inboxes200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


