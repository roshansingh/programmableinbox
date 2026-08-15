# CreateEmailInboxRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Email** | **string** | The address to claim. Normalized to lowercase before storage, and permanent once created. | 
**Name** | Pointer to **NullableString** | Optional display label. Subject to the same impersonation blocklist as the address. | [optional] 

## Methods

### NewCreateEmailInboxRequest

`func NewCreateEmailInboxRequest(email string, ) *CreateEmailInboxRequest`

NewCreateEmailInboxRequest instantiates a new CreateEmailInboxRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewCreateEmailInboxRequestWithDefaults

`func NewCreateEmailInboxRequestWithDefaults() *CreateEmailInboxRequest`

NewCreateEmailInboxRequestWithDefaults instantiates a new CreateEmailInboxRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetEmail

`func (o *CreateEmailInboxRequest) GetEmail() string`

GetEmail returns the Email field if non-nil, zero value otherwise.

### GetEmailOk

`func (o *CreateEmailInboxRequest) GetEmailOk() (*string, bool)`

GetEmailOk returns a tuple with the Email field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEmail

`func (o *CreateEmailInboxRequest) SetEmail(v string)`

SetEmail sets Email field to given value.


### GetName

`func (o *CreateEmailInboxRequest) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *CreateEmailInboxRequest) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *CreateEmailInboxRequest) SetName(v string)`

SetName sets Name field to given value.

### HasName

`func (o *CreateEmailInboxRequest) HasName() bool`

HasName returns a boolean if a field has been set.

### SetNameNil

`func (o *CreateEmailInboxRequest) SetNameNil(b bool)`

 SetNameNil sets the value for Name to be an explicit nil

### UnsetName
`func (o *CreateEmailInboxRequest) UnsetName()`

UnsetName ensures that no value is present for Name, not even an explicit nil

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


