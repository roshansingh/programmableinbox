# GetEmailInboxMessages200ResponseData

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Messages** | [**[]GetEmailInboxMessages200ResponseDataMessagesInner**](GetEmailInboxMessages200ResponseDataMessagesInner.md) |  | 
**NextCursor** | **NullableString** | Cursor for the next page, or null if there are no more results | 
**HasMore** | **bool** | True if more results exist beyond this page | 

## Methods

### NewGetEmailInboxMessages200ResponseData

`func NewGetEmailInboxMessages200ResponseData(messages []GetEmailInboxMessages200ResponseDataMessagesInner, nextCursor NullableString, hasMore bool, ) *GetEmailInboxMessages200ResponseData`

NewGetEmailInboxMessages200ResponseData instantiates a new GetEmailInboxMessages200ResponseData object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewGetEmailInboxMessages200ResponseDataWithDefaults

`func NewGetEmailInboxMessages200ResponseDataWithDefaults() *GetEmailInboxMessages200ResponseData`

NewGetEmailInboxMessages200ResponseDataWithDefaults instantiates a new GetEmailInboxMessages200ResponseData object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetMessages

`func (o *GetEmailInboxMessages200ResponseData) GetMessages() []GetEmailInboxMessages200ResponseDataMessagesInner`

GetMessages returns the Messages field if non-nil, zero value otherwise.

### GetMessagesOk

`func (o *GetEmailInboxMessages200ResponseData) GetMessagesOk() (*[]GetEmailInboxMessages200ResponseDataMessagesInner, bool)`

GetMessagesOk returns a tuple with the Messages field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMessages

`func (o *GetEmailInboxMessages200ResponseData) SetMessages(v []GetEmailInboxMessages200ResponseDataMessagesInner)`

SetMessages sets Messages field to given value.


### GetNextCursor

`func (o *GetEmailInboxMessages200ResponseData) GetNextCursor() string`

GetNextCursor returns the NextCursor field if non-nil, zero value otherwise.

### GetNextCursorOk

`func (o *GetEmailInboxMessages200ResponseData) GetNextCursorOk() (*string, bool)`

GetNextCursorOk returns a tuple with the NextCursor field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetNextCursor

`func (o *GetEmailInboxMessages200ResponseData) SetNextCursor(v string)`

SetNextCursor sets NextCursor field to given value.


### SetNextCursorNil

`func (o *GetEmailInboxMessages200ResponseData) SetNextCursorNil(b bool)`

 SetNextCursorNil sets the value for NextCursor to be an explicit nil

### UnsetNextCursor
`func (o *GetEmailInboxMessages200ResponseData) UnsetNextCursor()`

UnsetNextCursor ensures that no value is present for NextCursor, not even an explicit nil
### GetHasMore

`func (o *GetEmailInboxMessages200ResponseData) GetHasMore() bool`

GetHasMore returns the HasMore field if non-nil, zero value otherwise.

### GetHasMoreOk

`func (o *GetEmailInboxMessages200ResponseData) GetHasMoreOk() (*bool, bool)`

GetHasMoreOk returns a tuple with the HasMore field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetHasMore

`func (o *GetEmailInboxMessages200ResponseData) SetHasMore(v bool)`

SetHasMore sets HasMore field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


