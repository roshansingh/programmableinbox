# GetEmailInboxOtp200ResponseData

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Otp** | **string** |  | 
**Message** | [**EmailMessage**](EmailMessage.md) |  | 

## Methods

### NewGetEmailInboxOtp200ResponseData

`func NewGetEmailInboxOtp200ResponseData(otp string, message EmailMessage, ) *GetEmailInboxOtp200ResponseData`

NewGetEmailInboxOtp200ResponseData instantiates a new GetEmailInboxOtp200ResponseData object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewGetEmailInboxOtp200ResponseDataWithDefaults

`func NewGetEmailInboxOtp200ResponseDataWithDefaults() *GetEmailInboxOtp200ResponseData`

NewGetEmailInboxOtp200ResponseDataWithDefaults instantiates a new GetEmailInboxOtp200ResponseData object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetOtp

`func (o *GetEmailInboxOtp200ResponseData) GetOtp() string`

GetOtp returns the Otp field if non-nil, zero value otherwise.

### GetOtpOk

`func (o *GetEmailInboxOtp200ResponseData) GetOtpOk() (*string, bool)`

GetOtpOk returns a tuple with the Otp field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetOtp

`func (o *GetEmailInboxOtp200ResponseData) SetOtp(v string)`

SetOtp sets Otp field to given value.


### GetMessage

`func (o *GetEmailInboxOtp200ResponseData) GetMessage() EmailMessage`

GetMessage returns the Message field if non-nil, zero value otherwise.

### GetMessageOk

`func (o *GetEmailInboxOtp200ResponseData) GetMessageOk() (*EmailMessage, bool)`

GetMessageOk returns a tuple with the Message field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMessage

`func (o *GetEmailInboxOtp200ResponseData) SetMessage(v EmailMessage)`

SetMessage sets Message field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


