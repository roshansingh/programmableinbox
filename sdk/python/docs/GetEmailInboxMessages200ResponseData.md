# GetEmailInboxMessages200ResponseData


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**messages** | [**List[GetEmailInboxMessages200ResponseDataMessagesInner]**](GetEmailInboxMessages200ResponseDataMessagesInner.md) |  | 
**next_cursor** | **str** | Cursor for the next page, or null if there are no more results | 
**has_more** | **bool** | True if more results exist beyond this page | 

## Example

```python
from programmableinbox.models.get_email_inbox_messages200_response_data import GetEmailInboxMessages200ResponseData

# TODO update the JSON string below
json = "{}"
# create an instance of GetEmailInboxMessages200ResponseData from a JSON string
get_email_inbox_messages200_response_data_instance = GetEmailInboxMessages200ResponseData.from_json(json)
# print the JSON string representation of the object
print(GetEmailInboxMessages200ResponseData.to_json())

# convert the object into a dict
get_email_inbox_messages200_response_data_dict = get_email_inbox_messages200_response_data_instance.to_dict()
# create an instance of GetEmailInboxMessages200ResponseData from a dict
get_email_inbox_messages200_response_data_from_dict = GetEmailInboxMessages200ResponseData.from_dict(get_email_inbox_messages200_response_data_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


