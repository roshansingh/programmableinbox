# UpdateEmailInboxRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Name** | Pointer to **NullableString** | The new display label. Subject to the impersonation blocklist, so an inbox cannot be renamed into one. | [optional] 
**Email** | Pointer to **string** | Accepted only when it matches the current address. Present so a client can round-trip a full record; any other value is a 409. | [optional] 

## Methods

### NewUpdateEmailInboxRequest

`func NewUpdateEmailInboxRequest() *UpdateEmailInboxRequest`

NewUpdateEmailInboxRequest instantiates a new UpdateEmailInboxRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewUpdateEmailInboxRequestWithDefaults

`func NewUpdateEmailInboxRequestWithDefaults() *UpdateEmailInboxRequest`

NewUpdateEmailInboxRequestWithDefaults instantiates a new UpdateEmailInboxRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetName

`func (o *UpdateEmailInboxRequest) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *UpdateEmailInboxRequest) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *UpdateEmailInboxRequest) SetName(v string)`

SetName sets Name field to given value.

### HasName

`func (o *UpdateEmailInboxRequest) HasName() bool`

HasName returns a boolean if a field has been set.

### SetNameNil

`func (o *UpdateEmailInboxRequest) SetNameNil(b bool)`

 SetNameNil sets the value for Name to be an explicit nil

### UnsetName
`func (o *UpdateEmailInboxRequest) UnsetName()`

UnsetName ensures that no value is present for Name, not even an explicit nil
### GetEmail

`func (o *UpdateEmailInboxRequest) GetEmail() string`

GetEmail returns the Email field if non-nil, zero value otherwise.

### GetEmailOk

`func (o *UpdateEmailInboxRequest) GetEmailOk() (*string, bool)`

GetEmailOk returns a tuple with the Email field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEmail

`func (o *UpdateEmailInboxRequest) SetEmail(v string)`

SetEmail sets Email field to given value.

### HasEmail

`func (o *UpdateEmailInboxRequest) HasEmail() bool`

HasEmail returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


