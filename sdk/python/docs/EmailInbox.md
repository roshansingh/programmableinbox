# EmailInbox

An email inbox

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **str** |  | 
**organization_id** | **str** |  | 
**email** | **str** |  | 
**name** | **str** |  | 
**created_at** | **datetime** |  | 
**updated_at** | **datetime** |  | 

## Example

```python
from programmableinbox.models.email_inbox import EmailInbox

# TODO update the JSON string below
json = "{}"
# create an instance of EmailInbox from a JSON string
email_inbox_instance = EmailInbox.from_json(json)
# print the JSON string representation of the object
print(EmailInbox.to_json())

# convert the object into a dict
email_inbox_dict = email_inbox_instance.to_dict()
# create an instance of EmailInbox from a dict
email_inbox_from_dict = EmailInbox.from_dict(email_inbox_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


