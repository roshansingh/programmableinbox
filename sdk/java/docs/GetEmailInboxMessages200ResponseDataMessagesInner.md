

# GetEmailInboxMessages200ResponseDataMessagesInner


## Properties

| Name | Type | Description | Notes |
|------------ | ------------- | ------------- | -------------|
|**id** | **String** |  |  |
|**threadId** | **String** |  |  |
|**parentMessageId** | **String** |  |  |
|**subject** | **String** |  |  |
|**from** | **String** |  |  |
|**to** | **List&lt;String&gt;** |  |  |
|**cc** | **List&lt;String&gt;** |  |  |
|**bcc** | **List&lt;String&gt;** |  |  |
|**text** | **String** |  |  |
|**html** | **String** |  |  |
|**bodyText** | **String** | Plain text of the body, and the field the &#x60;q&#x60; parameter searches. Equal to &#x60;text&#x60; when the sender supplied a text part, otherwise extracted from &#x60;html&#x60;. Null for messages stored before this field existed. |  |
|**isStarred** | **Boolean** |  |  |
|**isRead** | **Boolean** | Inbox-wide, not per-user: one shared flag reflecting whether any viewer has opened this message. |  |
|**tags** | **List&lt;String&gt;** |  |  |
|**categories** | **List&lt;String&gt;** | Categories assigned to the message. Matched by the &#x60;categories&#x60; parameter. |  |
|**extractedOtp** | **String** | One-time code parsed from the message body. Derived from text/html, which the same email_messages:read scope already returns. |  |
|**createdAt** | **OffsetDateTime** |  |  |
|**threadCount** | **Integer** | Number of messages in the thread (present only in grouped mode) |  [optional] |



