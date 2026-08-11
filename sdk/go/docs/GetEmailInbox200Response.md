# GetEmailInbox200Response

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Data** | Pointer to [**EmailInbox**](EmailInbox.md) |  | [optional] 

## Methods

### NewGetEmailInbox200Response

`func NewGetEmailInbox200Response() *GetEmailInbox200Response`

NewGetEmailInbox200Response instantiates a new GetEmailInbox200Response object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewGetEmailInbox200ResponseWithDefaults

`func NewGetEmailInbox200ResponseWithDefaults() *GetEmailInbox200Response`

NewGetEmailInbox200ResponseWithDefaults instantiates a new GetEmailInbox200Response object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetData

`func (o *GetEmailInbox200Response) GetData() EmailInbox`

GetData returns the Data field if non-nil, zero value otherwise.

### GetDataOk

`func (o *GetEmailInbox200Response) GetDataOk() (*EmailInbox, bool)`

GetDataOk returns a tuple with the Data field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetData

`func (o *GetEmailInbox200Response) SetData(v EmailInbox)`

SetData sets Data field to given value.

### HasData

`func (o *GetEmailInbox200Response) HasData() bool`

HasData returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


