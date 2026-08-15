# ProgrammableInbox.Sdk.Api.EmailInboxesApi

All URIs are relative to *https://app.programmableinbox.com*

| Method | HTTP request | Description |
|--------|--------------|-------------|
| [**CreateEmailInbox**](EmailInboxesApi.md#createemailinbox) | **POST** /api/v1/emailInbox | Create an email inbox |
| [**DeleteEmailInbox**](EmailInboxesApi.md#deleteemailinbox) | **DELETE** /api/v1/emailInbox/{id} | Delete an email inbox |
| [**GetEmailInbox**](EmailInboxesApi.md#getemailinbox) | **GET** /api/v1/emailInbox/{id} | Get an email inbox |
| [**GetEmailInboxMessages**](EmailInboxesApi.md#getemailinboxmessages) | **GET** /api/v1/emailInbox/{id}/messages | Get messages from an email inbox |
| [**GetEmailInboxOtp**](EmailInboxesApi.md#getemailinboxotp) | **GET** /api/v1/emailInbox/{id}/otp | Get the latest one-time code for an inbox |
| [**GetEmailMessage**](EmailInboxesApi.md#getemailmessage) | **GET** /api/v1/emailInbox/{id}/messages/{messageId} | Get a single message |
| [**ListEmailInboxes**](EmailInboxesApi.md#listemailinboxes) | **GET** /api/v1/emailInbox | List email inboxes |
| [**UpdateEmailInbox**](EmailInboxesApi.md#updateemailinbox) | **PATCH** /api/v1/emailInbox/{id} | Rename an email inbox |

<a id="createemailinbox"></a>
# **CreateEmailInbox**
> CreateEmailInbox201Response CreateEmailInbox (CreateEmailInboxRequest createEmailInboxRequest)

Create an email inbox

Claims a new email address and returns the inbox. The address must be on a domain this account can receive at, and is immutable once created. Requires API key with `email_inboxes:create` scope. The inbox is always created in the organization the key is bound to — there is no way to name a different one.


### Parameters

| Name | Type | Description | Notes |
|------|------|-------------|-------|
| **createEmailInboxRequest** | [**CreateEmailInboxRequest**](CreateEmailInboxRequest.md) |  |  |

### Return type

[**CreateEmailInbox201Response**](CreateEmailInbox201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **201** | Inbox created |  -  |
| **400** | Bad request - malformed JSON, the address is not a valid email address, the domain is not one this account may create inboxes at, the local part is longer than 50 characters, or the name is not a string or is longer than 100 characters. |  -  |
| **401** | Unauthorized - missing or invalid API key |  -  |
| **403** | Forbidden - API key lacks the email_inboxes:create scope |  -  |
| **409** | Conflict - the address is not available. Returned identically whether it is held by another organization or by a deleted inbox, so this endpoint cannot be used to probe which addresses exist. |  -  |
| **422** | Unprocessable - the address or the name is on the impersonation blocklist, or the name contains characters outside printable ASCII. A disallowed domain is a 400, not this. |  -  |

[[Back to top]](#) [[Back to API list]](../../README.md#documentation-for-api-endpoints) [[Back to Model list]](../../README.md#documentation-for-models) [[Back to README]](../../README.md)

<a id="deleteemailinbox"></a>
# **DeleteEmailInbox**
> void DeleteEmailInbox (string id)

Delete an email inbox

Soft-deletes the inbox and its messages in one transaction. The rows are retained and every read filters them out, so the data is recoverable — but the **address is retired permanently and can never be claimed again, by anyone including you**. Mail keeps being delivered to it, so releasing it would hand the next claimant your still-arriving messages. Requires API key with `email_inboxes:delete` scope, which is granted separately from create and update for exactly this reason.


### Parameters

| Name | Type | Description | Notes |
|------|------|-------------|-------|
| **id** | **string** | The email inbox ID |  |

### Return type

void (empty response body)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **204** | Inbox deleted. No body — the record is no longer readable. |  -  |
| **401** | Unauthorized - missing or invalid API key |  -  |
| **403** | Forbidden - API key lacks the email_inboxes:delete scope. Holding create and update does not grant it. |  -  |
| **404** | Not found - no such inbox, or it is not one this key may delete. Deliberately indistinguishable. |  -  |

[[Back to top]](#) [[Back to API list]](../../README.md#documentation-for-api-endpoints) [[Back to Model list]](../../README.md#documentation-for-models) [[Back to README]](../../README.md)

<a id="getemailinbox"></a>
# **GetEmailInbox**
> GetEmailInbox200Response GetEmailInbox (string id)

Get an email inbox

Returns a single email inbox by id, scoped to the organization the API key is bound to. Requires API key with `email_inboxes:read` scope.


### Parameters

| Name | Type | Description | Notes |
|------|------|-------------|-------|
| **id** | **string** | Email inbox ID |  |

### Return type

[**GetEmailInbox200Response**](GetEmailInbox200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | The email inbox |  -  |
| **401** | Missing, malformed or revoked API key |  -  |
| **403** | API key lacks the email_inboxes:read scope |  -  |
| **404** | No such inbox in the organization the key is bound to. Deliberately indistinguishable from an inbox that does not exist. |  -  |

[[Back to top]](#) [[Back to API list]](../../README.md#documentation-for-api-endpoints) [[Back to Model list]](../../README.md#documentation-for-models) [[Back to README]](../../README.md)

<a id="getemailinboxmessages"></a>
# **GetEmailInboxMessages**
> GetEmailInboxMessages200Response GetEmailInboxMessages (string id, string cursor = null, int limit = null, string threadId = null, bool grouped = null, string q = null, string from = null, List<string> tags = null, List<string> categories = null)

Get messages from an email inbox

Returns messages for a specific email inbox with optional pagination and filtering. Requires API key with `email_messages:read` scope.


### Parameters

| Name | Type | Description | Notes |
|------|------|-------------|-------|
| **id** | **string** | The email inbox ID |  |
| **cursor** | **string** | Opaque pagination cursor from a previous response&#39;s nextCursor. Omit for the first page. | [optional]  |
| **limit** | **int** | Number of messages per page (default: 50, max: 100) | [optional]  |
| **threadId** | **string** | Optional thread ID to filter messages to a specific thread | [optional]  |
| **grouped** | **bool** | If true, returns only the latest message per thread (grouped view). Cannot be combined with any search parameter — the combination returns 400. | [optional]  |
| **q** | **string** | Full-text search over the subject and the message body. Supports \&quot;quoted phrases\&quot;, &#x60;or&#x60;, and &#x60;-negation&#x60; (Postgres websearch syntax). The body searched is the plain-text &#x60;bodyText&#x60; field, which is extracted from &#x60;html&#x60; for messages that carry no text part. Results stay in reverse-chronological order — this filters, it does not rank. | [optional]  |
| **from** | **string** | Case-insensitive substring match on the sender. Matches the raw header, so it covers both the display name and the address. | [optional]  |
| **tags** | [**List&lt;string&gt;**](string.md) | Return messages carrying any of these tags (exact match, OR-combined). Repeat the parameter: tags&#x3D;a&amp;tags&#x3D;b. A comma-separated single value (tags&#x3D;a,b) is also accepted, but cannot express a tag that itself contains a comma. Max 20 values. | [optional]  |
| **categories** | [**List&lt;string&gt;**](string.md) | Return messages carrying any of these categories (exact match, OR-combined). Repeat the parameter: categories&#x3D;a&amp;categories&#x3D;b. A comma-separated single value is also accepted, but cannot express a category that itself contains a comma. Max 20 values. | [optional]  |

### Return type

[**GetEmailInboxMessages200Response**](GetEmailInboxMessages200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Successfully retrieved messages |  -  |
| **400** | Invalid cursor, a search parameter over its length or value limit, or a search parameter combined with grouped&#x3D;true |  -  |
| **401** | Unauthorized - missing or invalid token/API key |  -  |
| **403** | Forbidden - user does not own inbox, API key lacks required scope (email_messages:read), or API key not authorized for this organization |  -  |
| **404** | Email inbox not found |  -  |

[[Back to top]](#) [[Back to API list]](../../README.md#documentation-for-api-endpoints) [[Back to Model list]](../../README.md#documentation-for-models) [[Back to README]](../../README.md)

<a id="getemailinboxotp"></a>
# **GetEmailInboxOtp**
> GetEmailInboxOtp200Response GetEmailInboxOtp (string id, string from = null, int withinMinutes = null)

Get the latest one-time code for an inbox

Returns the most recently extracted one-time passcode (OTP) for an email inbox, with the message it came from. Requires API key with `email_messages:read` scope — this is a read of extracted message content, not inbox metadata. Shares its lookup and arguments with the pibx_email_get_latest_otp MCP tool.


### Parameters

| Name | Type | Description | Notes |
|------|------|-------------|-------|
| **id** | **string** | The email inbox ID |  |
| **from** | **string** | Only consider messages whose From header contains this substring, e.g. \&quot;stripe.com\&quot;. Case-insensitive, matches the raw header. | [optional]  |
| **withinMinutes** | **int** | How recent the code must be. Defaults to 15 minutes, because a stale code looks identical to a fresh one and will silently fail wherever it is used. | [optional] [default to 15] |

### Return type

[**GetEmailInboxOtp200Response**](GetEmailInboxOtp200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Successfully retrieved the latest OTP |  -  |
| **400** | Bad request - withinMinutes out of range, or from over the length cap |  -  |
| **401** | Unauthorized - missing or invalid API key |  -  |
| **403** | Forbidden - API key lacks required scope (email_messages:read) |  -  |
| **404** | Not found - no such inbox visible to this key, or no message with an extracted OTP has arrived within withinMinutes. The message distinguishes a stale code (one exists but is older than the window) from none at all. |  -  |

[[Back to top]](#) [[Back to API list]](../../README.md#documentation-for-api-endpoints) [[Back to Model list]](../../README.md#documentation-for-models) [[Back to README]](../../README.md)

<a id="getemailmessage"></a>
# **GetEmailMessage**
> GetEmailMessage200Response GetEmailMessage (string id, string messageId)

Get a single message

Returns a specific message from an email inbox. Requires API key with `email_messages:read` scope.


### Parameters

| Name | Type | Description | Notes |
|------|------|-------------|-------|
| **id** | **string** | The email inbox ID |  |
| **messageId** | **string** | The message ID |  |

### Return type

[**GetEmailMessage200Response**](GetEmailMessage200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Successfully retrieved message |  -  |
| **401** | Unauthorized - missing or invalid API key |  -  |
| **403** | Forbidden - user does not own inbox, API key lacks required scope (email_messages:read), or API key not authorized for this organization |  -  |
| **404** | Message or inbox not found |  -  |

[[Back to top]](#) [[Back to API list]](../../README.md#documentation-for-api-endpoints) [[Back to Model list]](../../README.md#documentation-for-models) [[Back to README]](../../README.md)

<a id="listemailinboxes"></a>
# **ListEmailInboxes**
> ListEmailInboxes200Response ListEmailInboxes ()

List email inboxes

Returns a list of email inboxes for the organization. Requires API key with `email_inboxes:read` scope.


### Parameters
This endpoint does not need any parameter.
### Return type

[**ListEmailInboxes200Response**](ListEmailInboxes200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Successfully retrieved email inboxes |  -  |
| **401** | Unauthorized - missing or invalid token/API key |  -  |
| **403** | Forbidden - API key lacks required scope (email_inboxes:read) |  -  |

[[Back to top]](#) [[Back to API list]](../../README.md#documentation-for-api-endpoints) [[Back to Model list]](../../README.md#documentation-for-models) [[Back to README]](../../README.md)

<a id="updateemailinbox"></a>
# **UpdateEmailInbox**
> CreateEmailInbox201Response UpdateEmailInbox (string id, UpdateEmailInboxRequest updateEmailInboxRequest)

Rename an email inbox

Updates an inbox display name. The address is immutable — submitting a different one is a 409; submitting the current one (after normalization) is an allowed no-op, so a client can PATCH a whole record back. Requires API key with `email_inboxes:update` scope.


### Parameters

| Name | Type | Description | Notes |
|------|------|-------------|-------|
| **id** | **string** | The email inbox ID |  |
| **updateEmailInboxRequest** | [**UpdateEmailInboxRequest**](UpdateEmailInboxRequest.md) |  |  |

### Return type

[**CreateEmailInbox201Response**](CreateEmailInbox201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Inbox updated |  -  |
| **400** | Bad request - malformed JSON, the name is not a string or is longer than 100 characters, or &#x60;email&#x60; was supplied and is not a valid email address. A well-formed address that differs from the current one is a 409 instead. |  -  |
| **401** | Unauthorized - missing or invalid API key |  -  |
| **403** | Forbidden - API key lacks the email_inboxes:update scope |  -  |
| **404** | Not found - no such inbox, or it is not one this key may modify. Deliberately indistinguishable. |  -  |
| **409** | Conflict - the address of an inbox cannot be changed |  -  |
| **422** | Unprocessable - the name is on the impersonation blocklist, or it contains characters outside printable ASCII. Both are the same rule: a Cyrillic lookalike normalizes past the blocklist and only the charset guard stops it. |  -  |

[[Back to top]](#) [[Back to API list]](../../README.md#documentation-for-api-endpoints) [[Back to Model list]](../../README.md#documentation-for-models) [[Back to README]](../../README.md)

