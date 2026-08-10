# GetEmailInboxMessages200ResponseDataMessagesInner


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **str** |  | 
**thread_id** | **str** |  | 
**parent_message_id** | **str** |  | 
**subject** | **str** |  | 
**var_from** | **str** |  | 
**to** | **List[str]** |  | 
**cc** | **List[str]** |  | 
**bcc** | **List[str]** |  | 
**text** | **str** |  | 
**html** | **str** |  | 
**body_text** | **str** | Plain text of the body, and the field the &#x60;q&#x60; parameter searches. Equal to &#x60;text&#x60; when the sender supplied a text part, otherwise extracted from &#x60;html&#x60;. Null for messages stored before this field existed. | 
**is_starred** | **bool** |  | 
**tags** | **List[str]** |  | 
**categories** | **List[str]** | Categories assigned to the message. Matched by the &#x60;categories&#x60; parameter. | 
**extracted_otp** | **str** | One-time code parsed from the message body. Derived from text/html, which the same email_messages:read scope already returns. | 
**created_at** | **datetime** |  | 
**thread_count** | **int** | Number of messages in the thread (present only in grouped mode) | [optional] 

## Example

```python
from programmableinbox.models.get_email_inbox_messages200_response_data_messages_inner import GetEmailInboxMessages200ResponseDataMessagesInner

# TODO update the JSON string below
json = "{}"
# create an instance of GetEmailInboxMessages200ResponseDataMessagesInner from a JSON string
get_email_inbox_messages200_response_data_messages_inner_instance = GetEmailInboxMessages200ResponseDataMessagesInner.from_json(json)
# print the JSON string representation of the object
print(GetEmailInboxMessages200ResponseDataMessagesInner.to_json())

# convert the object into a dict
get_email_inbox_messages200_response_data_messages_inner_dict = get_email_inbox_messages200_response_data_messages_inner_instance.to_dict()
# create an instance of GetEmailInboxMessages200ResponseDataMessagesInner from a dict
get_email_inbox_messages200_response_data_messages_inner_from_dict = GetEmailInboxMessages200ResponseDataMessagesInner.from_dict(get_email_inbox_messages200_response_data_messages_inner_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


