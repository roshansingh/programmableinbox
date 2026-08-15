# GetEmailInboxOtp200ResponseData

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Otp** | **string** |  | 
**ReceivedAt** | **time.Time** |  | 
**MessageId** | **string** |  | 
**From** | **string** |  | 

## Methods

### NewGetEmailInboxOtp200ResponseData

`func NewGetEmailInboxOtp200ResponseData(otp string, receivedAt time.Time, messageId string, from string, ) *GetEmailInboxOtp200ResponseData`

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


### GetReceivedAt

`func (o *GetEmailInboxOtp200ResponseData) GetReceivedAt() time.Time`

GetReceivedAt returns the ReceivedAt field if non-nil, zero value otherwise.

### GetReceivedAtOk

`func (o *GetEmailInboxOtp200ResponseData) GetReceivedAtOk() (*time.Time, bool)`

GetReceivedAtOk returns a tuple with the ReceivedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetReceivedAt

`func (o *GetEmailInboxOtp200ResponseData) SetReceivedAt(v time.Time)`

SetReceivedAt sets ReceivedAt field to given value.


### GetMessageId

`func (o *GetEmailInboxOtp200ResponseData) GetMessageId() string`

GetMessageId returns the MessageId field if non-nil, zero value otherwise.

### GetMessageIdOk

`func (o *GetEmailInboxOtp200ResponseData) GetMessageIdOk() (*string, bool)`

GetMessageIdOk returns a tuple with the MessageId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMessageId

`func (o *GetEmailInboxOtp200ResponseData) SetMessageId(v string)`

SetMessageId sets MessageId field to given value.


### GetFrom

`func (o *GetEmailInboxOtp200ResponseData) GetFrom() string`

GetFrom returns the From field if non-nil, zero value otherwise.

### GetFromOk

`func (o *GetEmailInboxOtp200ResponseData) GetFromOk() (*string, bool)`

GetFromOk returns a tuple with the From field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetFrom

`func (o *GetEmailInboxOtp200ResponseData) SetFrom(v string)`

SetFrom sets From field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


