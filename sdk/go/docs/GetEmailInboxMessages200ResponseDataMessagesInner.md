# GetEmailInboxMessages200ResponseDataMessagesInner

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | **string** |  | 
**ThreadId** | **string** |  | 
**ParentMessageId** | **NullableString** |  | 
**Subject** | **string** |  | 
**From** | **string** |  | 
**To** | **[]string** |  | 
**Cc** | **[]string** |  | 
**Bcc** | **[]string** |  | 
**Text** | **string** |  | 
**Html** | **string** |  | 
**BodyText** | **NullableString** | Plain text of the body, and the field the &#x60;q&#x60; parameter searches. Equal to &#x60;text&#x60; when the sender supplied a text part, otherwise extracted from &#x60;html&#x60;. Null for messages stored before this field existed. | 
**IsStarred** | **bool** |  | 
**IsRead** | **bool** | Inbox-wide, not per-user: one shared flag reflecting whether any viewer has opened this message. | 
**Tags** | **[]string** |  | 
**Categories** | **[]string** | Categories assigned to the message. Matched by the &#x60;categories&#x60; parameter. | 
**ExtractedOtp** | **NullableString** | One-time code parsed from the message body. Derived from text/html, which the same email_messages:read scope already returns. | 
**CreatedAt** | **time.Time** |  | 
**ThreadCount** | Pointer to **int32** | Number of messages in the thread (present only in grouped mode) | [optional] 

## Methods

### NewGetEmailInboxMessages200ResponseDataMessagesInner

`func NewGetEmailInboxMessages200ResponseDataMessagesInner(id string, threadId string, parentMessageId NullableString, subject string, from string, to []string, cc []string, bcc []string, text string, html string, bodyText NullableString, isStarred bool, isRead bool, tags []string, categories []string, extractedOtp NullableString, createdAt time.Time, ) *GetEmailInboxMessages200ResponseDataMessagesInner`

NewGetEmailInboxMessages200ResponseDataMessagesInner instantiates a new GetEmailInboxMessages200ResponseDataMessagesInner object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewGetEmailInboxMessages200ResponseDataMessagesInnerWithDefaults

`func NewGetEmailInboxMessages200ResponseDataMessagesInnerWithDefaults() *GetEmailInboxMessages200ResponseDataMessagesInner`

NewGetEmailInboxMessages200ResponseDataMessagesInnerWithDefaults instantiates a new GetEmailInboxMessages200ResponseDataMessagesInner object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) SetId(v string)`

SetId sets Id field to given value.


### GetThreadId

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetThreadId() string`

GetThreadId returns the ThreadId field if non-nil, zero value otherwise.

### GetThreadIdOk

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetThreadIdOk() (*string, bool)`

GetThreadIdOk returns a tuple with the ThreadId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetThreadId

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) SetThreadId(v string)`

SetThreadId sets ThreadId field to given value.


### GetParentMessageId

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetParentMessageId() string`

GetParentMessageId returns the ParentMessageId field if non-nil, zero value otherwise.

### GetParentMessageIdOk

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetParentMessageIdOk() (*string, bool)`

GetParentMessageIdOk returns a tuple with the ParentMessageId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetParentMessageId

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) SetParentMessageId(v string)`

SetParentMessageId sets ParentMessageId field to given value.


### SetParentMessageIdNil

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) SetParentMessageIdNil(b bool)`

 SetParentMessageIdNil sets the value for ParentMessageId to be an explicit nil

### UnsetParentMessageId
`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) UnsetParentMessageId()`

UnsetParentMessageId ensures that no value is present for ParentMessageId, not even an explicit nil
### GetSubject

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetSubject() string`

GetSubject returns the Subject field if non-nil, zero value otherwise.

### GetSubjectOk

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetSubjectOk() (*string, bool)`

GetSubjectOk returns a tuple with the Subject field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSubject

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) SetSubject(v string)`

SetSubject sets Subject field to given value.


### GetFrom

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetFrom() string`

GetFrom returns the From field if non-nil, zero value otherwise.

### GetFromOk

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetFromOk() (*string, bool)`

GetFromOk returns a tuple with the From field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetFrom

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) SetFrom(v string)`

SetFrom sets From field to given value.


### GetTo

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetTo() []string`

GetTo returns the To field if non-nil, zero value otherwise.

### GetToOk

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetToOk() (*[]string, bool)`

GetToOk returns a tuple with the To field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTo

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) SetTo(v []string)`

SetTo sets To field to given value.


### GetCc

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetCc() []string`

GetCc returns the Cc field if non-nil, zero value otherwise.

### GetCcOk

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetCcOk() (*[]string, bool)`

GetCcOk returns a tuple with the Cc field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCc

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) SetCc(v []string)`

SetCc sets Cc field to given value.


### GetBcc

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetBcc() []string`

GetBcc returns the Bcc field if non-nil, zero value otherwise.

### GetBccOk

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetBccOk() (*[]string, bool)`

GetBccOk returns a tuple with the Bcc field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetBcc

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) SetBcc(v []string)`

SetBcc sets Bcc field to given value.


### GetText

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetText() string`

GetText returns the Text field if non-nil, zero value otherwise.

### GetTextOk

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetTextOk() (*string, bool)`

GetTextOk returns a tuple with the Text field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetText

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) SetText(v string)`

SetText sets Text field to given value.


### GetHtml

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetHtml() string`

GetHtml returns the Html field if non-nil, zero value otherwise.

### GetHtmlOk

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetHtmlOk() (*string, bool)`

GetHtmlOk returns a tuple with the Html field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetHtml

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) SetHtml(v string)`

SetHtml sets Html field to given value.


### GetBodyText

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetBodyText() string`

GetBodyText returns the BodyText field if non-nil, zero value otherwise.

### GetBodyTextOk

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetBodyTextOk() (*string, bool)`

GetBodyTextOk returns a tuple with the BodyText field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetBodyText

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) SetBodyText(v string)`

SetBodyText sets BodyText field to given value.


### SetBodyTextNil

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) SetBodyTextNil(b bool)`

 SetBodyTextNil sets the value for BodyText to be an explicit nil

### UnsetBodyText
`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) UnsetBodyText()`

UnsetBodyText ensures that no value is present for BodyText, not even an explicit nil
### GetIsStarred

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetIsStarred() bool`

GetIsStarred returns the IsStarred field if non-nil, zero value otherwise.

### GetIsStarredOk

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetIsStarredOk() (*bool, bool)`

GetIsStarredOk returns a tuple with the IsStarred field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetIsStarred

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) SetIsStarred(v bool)`

SetIsStarred sets IsStarred field to given value.


### GetIsRead

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetIsRead() bool`

GetIsRead returns the IsRead field if non-nil, zero value otherwise.

### GetIsReadOk

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetIsReadOk() (*bool, bool)`

GetIsReadOk returns a tuple with the IsRead field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetIsRead

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) SetIsRead(v bool)`

SetIsRead sets IsRead field to given value.


### GetTags

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetTags() []string`

GetTags returns the Tags field if non-nil, zero value otherwise.

### GetTagsOk

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetTagsOk() (*[]string, bool)`

GetTagsOk returns a tuple with the Tags field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTags

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) SetTags(v []string)`

SetTags sets Tags field to given value.


### GetCategories

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetCategories() []string`

GetCategories returns the Categories field if non-nil, zero value otherwise.

### GetCategoriesOk

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetCategoriesOk() (*[]string, bool)`

GetCategoriesOk returns a tuple with the Categories field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCategories

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) SetCategories(v []string)`

SetCategories sets Categories field to given value.


### GetExtractedOtp

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetExtractedOtp() string`

GetExtractedOtp returns the ExtractedOtp field if non-nil, zero value otherwise.

### GetExtractedOtpOk

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetExtractedOtpOk() (*string, bool)`

GetExtractedOtpOk returns a tuple with the ExtractedOtp field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetExtractedOtp

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) SetExtractedOtp(v string)`

SetExtractedOtp sets ExtractedOtp field to given value.


### SetExtractedOtpNil

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) SetExtractedOtpNil(b bool)`

 SetExtractedOtpNil sets the value for ExtractedOtp to be an explicit nil

### UnsetExtractedOtp
`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) UnsetExtractedOtp()`

UnsetExtractedOtp ensures that no value is present for ExtractedOtp, not even an explicit nil
### GetCreatedAt

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetCreatedAt() time.Time`

GetCreatedAt returns the CreatedAt field if non-nil, zero value otherwise.

### GetCreatedAtOk

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetCreatedAtOk() (*time.Time, bool)`

GetCreatedAtOk returns a tuple with the CreatedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCreatedAt

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) SetCreatedAt(v time.Time)`

SetCreatedAt sets CreatedAt field to given value.


### GetThreadCount

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetThreadCount() int32`

GetThreadCount returns the ThreadCount field if non-nil, zero value otherwise.

### GetThreadCountOk

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) GetThreadCountOk() (*int32, bool)`

GetThreadCountOk returns a tuple with the ThreadCount field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetThreadCount

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) SetThreadCount(v int32)`

SetThreadCount sets ThreadCount field to given value.

### HasThreadCount

`func (o *GetEmailInboxMessages200ResponseDataMessagesInner) HasThreadCount() bool`

HasThreadCount returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


