# GetEmailInboxMessages200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | [**GetEmailInboxMessages200ResponseData**](GetEmailInboxMessages200ResponseData.md) |  | 

## Example

```python
from programmableinbox.models.get_email_inbox_messages200_response import GetEmailInboxMessages200Response

# TODO update the JSON string below
json = "{}"
# create an instance of GetEmailInboxMessages200Response from a JSON string
get_email_inbox_messages200_response_instance = GetEmailInboxMessages200Response.from_json(json)
# print the JSON string representation of the object
print(GetEmailInboxMessages200Response.to_json())

# convert the object into a dict
get_email_inbox_messages200_response_dict = get_email_inbox_messages200_response_instance.to_dict()
# create an instance of GetEmailInboxMessages200Response from a dict
get_email_inbox_messages200_response_from_dict = GetEmailInboxMessages200Response.from_dict(get_email_inbox_messages200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


