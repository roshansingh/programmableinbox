# CreateEmailInbox201Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | [**EmailInbox**](EmailInbox.md) |  | 

## Example

```python
from programmableinbox.models.create_email_inbox201_response import CreateEmailInbox201Response

# TODO update the JSON string below
json = "{}"
# create an instance of CreateEmailInbox201Response from a JSON string
create_email_inbox201_response_instance = CreateEmailInbox201Response.from_json(json)
# print the JSON string representation of the object
print(CreateEmailInbox201Response.to_json())

# convert the object into a dict
create_email_inbox201_response_dict = create_email_inbox201_response_instance.to_dict()
# create an instance of CreateEmailInbox201Response from a dict
create_email_inbox201_response_from_dict = CreateEmailInbox201Response.from_dict(create_email_inbox201_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


