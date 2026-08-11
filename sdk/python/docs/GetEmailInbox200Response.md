# GetEmailInbox200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | [**EmailInbox**](EmailInbox.md) |  | [optional] 

## Example

```python
from programmableinbox.models.get_email_inbox200_response import GetEmailInbox200Response

# TODO update the JSON string below
json = "{}"
# create an instance of GetEmailInbox200Response from a JSON string
get_email_inbox200_response_instance = GetEmailInbox200Response.from_json(json)
# print the JSON string representation of the object
print(GetEmailInbox200Response.to_json())

# convert the object into a dict
get_email_inbox200_response_dict = get_email_inbox200_response_instance.to_dict()
# create an instance of GetEmailInbox200Response from a dict
get_email_inbox200_response_from_dict = GetEmailInbox200Response.from_dict(get_email_inbox200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


