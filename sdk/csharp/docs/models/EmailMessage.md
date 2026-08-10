# ProgrammableInbox.Sdk.Model.EmailMessage
An email message

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | **string** |  | 
**ThreadId** | **string** |  | 
**Subject** | **string** |  | 
**From** | **string** |  | 
**To** | **List&lt;string&gt;** |  | 
**Cc** | **List&lt;string&gt;** |  | 
**Bcc** | **List&lt;string&gt;** |  | 
**Text** | **string** |  | 
**Html** | **string** |  | 
**IsStarred** | **bool** |  | 
**Tags** | **List&lt;string&gt;** |  | 
**Categories** | **List&lt;string&gt;** | Categories assigned to the message. Matched by the &#x60;categories&#x60; parameter. | 
**CreatedAt** | **DateTime** |  | 
**ParentMessageId** | **string** |  | 
**BodyText** | **string** | Plain text of the body, and the field the &#x60;q&#x60; parameter searches. Equal to &#x60;text&#x60; when the sender supplied a text part, otherwise extracted from &#x60;html&#x60;. Null for messages stored before this field existed. | 
**ExtractedOtp** | **string** | One-time code parsed from the message body. Derived from text/html, which the same email_messages:read scope already returns. | 
**ThreadCount** | **int** | Number of messages in the thread (present only in grouped mode) | [optional] 

[[Back to Model list]](../../README.md#documentation-for-models) [[Back to API list]](../../README.md#documentation-for-api-endpoints) [[Back to README]](../../README.md)

