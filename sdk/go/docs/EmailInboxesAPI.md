# \EmailInboxesAPI

All URIs are relative to *https://app.programmableinbox.com*

Method | HTTP request | Description
------------- | ------------- | -------------
[**CreateEmailInbox**](EmailInboxesAPI.md#CreateEmailInbox) | **Post** /api/v1/emailInbox | Create an email inbox
[**DeleteEmailInbox**](EmailInboxesAPI.md#DeleteEmailInbox) | **Delete** /api/v1/emailInbox/{id} | Delete an email inbox
[**GetEmailInbox**](EmailInboxesAPI.md#GetEmailInbox) | **Get** /api/v1/emailInbox/{id} | Get an email inbox
[**GetEmailInboxMessages**](EmailInboxesAPI.md#GetEmailInboxMessages) | **Get** /api/v1/emailInbox/{id}/messages | Get messages from an email inbox
[**GetEmailInboxOtp**](EmailInboxesAPI.md#GetEmailInboxOtp) | **Get** /api/v1/emailInbox/{id}/otp | Get the latest one-time code for an inbox
[**GetEmailMessage**](EmailInboxesAPI.md#GetEmailMessage) | **Get** /api/v1/emailInbox/{id}/messages/{messageId} | Get a single message
[**ListEmailInboxes**](EmailInboxesAPI.md#ListEmailInboxes) | **Get** /api/v1/emailInbox | List email inboxes
[**UpdateEmailInbox**](EmailInboxesAPI.md#UpdateEmailInbox) | **Patch** /api/v1/emailInbox/{id} | Rename an email inbox



## CreateEmailInbox

> CreateEmailInbox201Response CreateEmailInbox(ctx).CreateEmailInboxRequest(createEmailInboxRequest).Execute()

Create an email inbox



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/roshansingh/programmableinbox-go"
)

func main() {
	createEmailInboxRequest := *openapiclient.NewCreateEmailInboxRequest("Email_example") // CreateEmailInboxRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.EmailInboxesAPI.CreateEmailInbox(context.Background()).CreateEmailInboxRequest(createEmailInboxRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `EmailInboxesAPI.CreateEmailInbox``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `CreateEmailInbox`: CreateEmailInbox201Response
	fmt.Fprintf(os.Stdout, "Response from `EmailInboxesAPI.CreateEmailInbox`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiCreateEmailInboxRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **createEmailInboxRequest** | [**CreateEmailInboxRequest**](CreateEmailInboxRequest.md) |  | 

### Return type

[**CreateEmailInbox201Response**](CreateEmailInbox201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## DeleteEmailInbox

> DeleteEmailInbox(ctx, id).Execute()

Delete an email inbox



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/roshansingh/programmableinbox-go"
)

func main() {
	id := "id_example" // string | The email inbox ID

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	r, err := apiClient.EmailInboxesAPI.DeleteEmailInbox(context.Background(), id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `EmailInboxesAPI.DeleteEmailInbox``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** | The email inbox ID | 

### Other Parameters

Other parameters are passed through a pointer to a apiDeleteEmailInboxRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

 (empty response body)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## GetEmailInbox

> GetEmailInbox200Response GetEmailInbox(ctx, id).Execute()

Get an email inbox



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/roshansingh/programmableinbox-go"
)

func main() {
	id := "id_example" // string | Email inbox ID

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.EmailInboxesAPI.GetEmailInbox(context.Background(), id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `EmailInboxesAPI.GetEmailInbox``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GetEmailInbox`: GetEmailInbox200Response
	fmt.Fprintf(os.Stdout, "Response from `EmailInboxesAPI.GetEmailInbox`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** | Email inbox ID | 

### Other Parameters

Other parameters are passed through a pointer to a apiGetEmailInboxRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

[**GetEmailInbox200Response**](GetEmailInbox200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## GetEmailInboxMessages

> GetEmailInboxMessages200Response GetEmailInboxMessages(ctx, id).Cursor(cursor).Limit(limit).ThreadId(threadId).Grouped(grouped).Q(q).From(from).Tags(tags).Categories(categories).Execute()

Get messages from an email inbox



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/roshansingh/programmableinbox-go"
)

func main() {
	id := "id_example" // string | The email inbox ID
	cursor := "cursor_example" // string | Opaque pagination cursor from a previous response's nextCursor. Omit for the first page. (optional)
	limit := int32(56) // int32 | Number of messages per page (default: 50, max: 100) (optional)
	threadId := "threadId_example" // string | Optional thread ID to filter messages to a specific thread (optional)
	grouped := true // bool | If true, returns only the latest message per thread (grouped view). Cannot be combined with any search parameter — the combination returns 400. (optional)
	q := "q_example" // string | Full-text search over the subject and the message body. Supports \"quoted phrases\", `or`, and `-negation` (Postgres websearch syntax). The body searched is the plain-text `bodyText` field, which is extracted from `html` for messages that carry no text part. Results stay in reverse-chronological order — this filters, it does not rank. (optional)
	from := "from_example" // string | Case-insensitive substring match on the sender. Matches the raw header, so it covers both the display name and the address. (optional)
	tags := []string{"Inner_example"} // []string | Return messages carrying any of these tags (exact match, OR-combined). Repeat the parameter: tags=a&tags=b. A comma-separated single value (tags=a,b) is also accepted, but cannot express a tag that itself contains a comma. Max 20 values. (optional)
	categories := []string{"Inner_example"} // []string | Return messages carrying any of these categories (exact match, OR-combined). Repeat the parameter: categories=a&categories=b. A comma-separated single value is also accepted, but cannot express a category that itself contains a comma. Max 20 values. (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.EmailInboxesAPI.GetEmailInboxMessages(context.Background(), id).Cursor(cursor).Limit(limit).ThreadId(threadId).Grouped(grouped).Q(q).From(from).Tags(tags).Categories(categories).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `EmailInboxesAPI.GetEmailInboxMessages``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GetEmailInboxMessages`: GetEmailInboxMessages200Response
	fmt.Fprintf(os.Stdout, "Response from `EmailInboxesAPI.GetEmailInboxMessages`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** | The email inbox ID | 

### Other Parameters

Other parameters are passed through a pointer to a apiGetEmailInboxMessagesRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **cursor** | **string** | Opaque pagination cursor from a previous response&#39;s nextCursor. Omit for the first page. | 
 **limit** | **int32** | Number of messages per page (default: 50, max: 100) | 
 **threadId** | **string** | Optional thread ID to filter messages to a specific thread | 
 **grouped** | **bool** | If true, returns only the latest message per thread (grouped view). Cannot be combined with any search parameter — the combination returns 400. | 
 **q** | **string** | Full-text search over the subject and the message body. Supports \&quot;quoted phrases\&quot;, &#x60;or&#x60;, and &#x60;-negation&#x60; (Postgres websearch syntax). The body searched is the plain-text &#x60;bodyText&#x60; field, which is extracted from &#x60;html&#x60; for messages that carry no text part. Results stay in reverse-chronological order — this filters, it does not rank. | 
 **from** | **string** | Case-insensitive substring match on the sender. Matches the raw header, so it covers both the display name and the address. | 
 **tags** | **[]string** | Return messages carrying any of these tags (exact match, OR-combined). Repeat the parameter: tags&#x3D;a&amp;tags&#x3D;b. A comma-separated single value (tags&#x3D;a,b) is also accepted, but cannot express a tag that itself contains a comma. Max 20 values. | 
 **categories** | **[]string** | Return messages carrying any of these categories (exact match, OR-combined). Repeat the parameter: categories&#x3D;a&amp;categories&#x3D;b. A comma-separated single value is also accepted, but cannot express a category that itself contains a comma. Max 20 values. | 

### Return type

[**GetEmailInboxMessages200Response**](GetEmailInboxMessages200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## GetEmailInboxOtp

> GetEmailInboxOtp200Response GetEmailInboxOtp(ctx, id).From(from).WithinMinutes(withinMinutes).Execute()

Get the latest one-time code for an inbox



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/roshansingh/programmableinbox-go"
)

func main() {
	id := "id_example" // string | The email inbox ID
	from := "from_example" // string | Only consider messages whose From header contains this substring, e.g. \"stripe.com\". Case-insensitive, matches the raw header. (optional)
	withinMinutes := int32(56) // int32 | How recent the code must be. Defaults to 15 minutes, because a stale code looks identical to a fresh one and will silently fail wherever it is used. (optional) (default to 15)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.EmailInboxesAPI.GetEmailInboxOtp(context.Background(), id).From(from).WithinMinutes(withinMinutes).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `EmailInboxesAPI.GetEmailInboxOtp``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GetEmailInboxOtp`: GetEmailInboxOtp200Response
	fmt.Fprintf(os.Stdout, "Response from `EmailInboxesAPI.GetEmailInboxOtp`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** | The email inbox ID | 

### Other Parameters

Other parameters are passed through a pointer to a apiGetEmailInboxOtpRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **from** | **string** | Only consider messages whose From header contains this substring, e.g. \&quot;stripe.com\&quot;. Case-insensitive, matches the raw header. | 
 **withinMinutes** | **int32** | How recent the code must be. Defaults to 15 minutes, because a stale code looks identical to a fresh one and will silently fail wherever it is used. | [default to 15]

### Return type

[**GetEmailInboxOtp200Response**](GetEmailInboxOtp200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## GetEmailMessage

> GetEmailMessage200Response GetEmailMessage(ctx, id, messageId).Execute()

Get a single message



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/roshansingh/programmableinbox-go"
)

func main() {
	id := "id_example" // string | The email inbox ID
	messageId := "messageId_example" // string | The message ID

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.EmailInboxesAPI.GetEmailMessage(context.Background(), id, messageId).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `EmailInboxesAPI.GetEmailMessage``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GetEmailMessage`: GetEmailMessage200Response
	fmt.Fprintf(os.Stdout, "Response from `EmailInboxesAPI.GetEmailMessage`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** | The email inbox ID | 
**messageId** | **string** | The message ID | 

### Other Parameters

Other parameters are passed through a pointer to a apiGetEmailMessageRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------



### Return type

[**GetEmailMessage200Response**](GetEmailMessage200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ListEmailInboxes

> ListEmailInboxes200Response ListEmailInboxes(ctx).Execute()

List email inboxes



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/roshansingh/programmableinbox-go"
)

func main() {

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.EmailInboxesAPI.ListEmailInboxes(context.Background()).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `EmailInboxesAPI.ListEmailInboxes``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ListEmailInboxes`: ListEmailInboxes200Response
	fmt.Fprintf(os.Stdout, "Response from `EmailInboxesAPI.ListEmailInboxes`: %v\n", resp)
}
```

### Path Parameters

This endpoint does not need any parameter.

### Other Parameters

Other parameters are passed through a pointer to a apiListEmailInboxesRequest struct via the builder pattern


### Return type

[**ListEmailInboxes200Response**](ListEmailInboxes200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## UpdateEmailInbox

> CreateEmailInbox201Response UpdateEmailInbox(ctx, id).UpdateEmailInboxRequest(updateEmailInboxRequest).Execute()

Rename an email inbox



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/roshansingh/programmableinbox-go"
)

func main() {
	id := "id_example" // string | The email inbox ID
	updateEmailInboxRequest := *openapiclient.NewUpdateEmailInboxRequest() // UpdateEmailInboxRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.EmailInboxesAPI.UpdateEmailInbox(context.Background(), id).UpdateEmailInboxRequest(updateEmailInboxRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `EmailInboxesAPI.UpdateEmailInbox``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `UpdateEmailInbox`: CreateEmailInbox201Response
	fmt.Fprintf(os.Stdout, "Response from `EmailInboxesAPI.UpdateEmailInbox`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** | The email inbox ID | 

### Other Parameters

Other parameters are passed through a pointer to a apiUpdateEmailInboxRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **updateEmailInboxRequest** | [**UpdateEmailInboxRequest**](UpdateEmailInboxRequest.md) |  | 

### Return type

[**CreateEmailInbox201Response**](CreateEmailInbox201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)

