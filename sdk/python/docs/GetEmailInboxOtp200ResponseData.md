# GetEmailInboxOtp200ResponseData


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**otp** | **str** |  | 
**received_at** | **datetime** |  | 
**message_id** | **str** |  | 
**var_from** | **str** |  | 

## Example

```python
from programmableinbox.models.get_email_inbox_otp200_response_data import GetEmailInboxOtp200ResponseData

# TODO update the JSON string below
json = "{}"
# create an instance of GetEmailInboxOtp200ResponseData from a JSON string
get_email_inbox_otp200_response_data_instance = GetEmailInboxOtp200ResponseData.from_json(json)
# print the JSON string representation of the object
print(GetEmailInboxOtp200ResponseData.to_json())

# convert the object into a dict
get_email_inbox_otp200_response_data_dict = get_email_inbox_otp200_response_data_instance.to_dict()
# create an instance of GetEmailInboxOtp200ResponseData from a dict
get_email_inbox_otp200_response_data_from_dict = GetEmailInboxOtp200ResponseData.from_dict(get_email_inbox_otp200_response_data_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


