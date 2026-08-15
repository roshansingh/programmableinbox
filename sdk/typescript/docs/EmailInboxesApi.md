# EmailInboxesApi

All URIs are relative to *https://app.programmableinbox.com*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**createEmailInbox**](EmailInboxesApi.md#createemailinboxoperation) | **POST** /api/v1/emailInbox | Create an email inbox |
| [**deleteEmailInbox**](EmailInboxesApi.md#deleteemailinbox) | **DELETE** /api/v1/emailInbox/{id} | Delete an email inbox |
| [**getEmailInbox**](EmailInboxesApi.md#getemailinbox) | **GET** /api/v1/emailInbox/{id} | Get an email inbox |
| [**getEmailInboxMessages**](EmailInboxesApi.md#getemailinboxmessages) | **GET** /api/v1/emailInbox/{id}/messages | Get messages from an email inbox |
| [**getEmailInboxOtp**](EmailInboxesApi.md#getemailinboxotp) | **GET** /api/v1/emailInbox/{id}/otp | Get the latest one-time code for an inbox |
| [**getEmailMessage**](EmailInboxesApi.md#getemailmessage) | **GET** /api/v1/emailInbox/{id}/messages/{messageId} | Get a single message |
| [**listEmailInboxes**](EmailInboxesApi.md#listemailinboxes) | **GET** /api/v1/emailInbox | List email inboxes |
| [**updateEmailInbox**](EmailInboxesApi.md#updateemailinboxoperation) | **PATCH** /api/v1/emailInbox/{id} | Rename an email inbox |



## createEmailInbox

> CreateEmailInbox201Response createEmailInbox(createEmailInboxRequest)

Create an email inbox

Claims a new email address and returns the inbox. The address must be on a domain this account can receive at, and is immutable once created. Requires API key with &#x60;email_inboxes:create&#x60; scope. The inbox is created in the organization the key is bound to; supplying a different &#x60;organizationId&#x60; is a 403 rather than a silently ignored field.

### Example

```ts
import {
  Configuration,
  EmailInboxesApi,
} from '@programmableinbox/sdk';
import type { CreateEmailInboxOperationRequest } from '@programmableinbox/sdk';

async function example() {
  console.log("🚀 Testing @programmableinbox/sdk SDK...");
  const config = new Configuration({ 
    // Configure HTTP bearer authorization: ApiKeyAuth
    accessToken: "YOUR BEARER TOKEN",
  });
  const api = new EmailInboxesApi(config);

  const body = {
    // CreateEmailInboxRequest
    createEmailInboxRequest: ...,
  } satisfies CreateEmailInboxOperationRequest;

  try {
    const data = await api.createEmailInbox(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **createEmailInboxRequest** | [CreateEmailInboxRequest](CreateEmailInboxRequest.md) |  | |

### Return type

[**CreateEmailInbox201Response**](CreateEmailInbox201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **201** | Inbox created |  -  |
| **400** | Bad request - malformed JSON, the address is not a valid email address, the domain is not one this account may create inboxes at, the local part is longer than 50 characters, or the name is not a string or is longer than 100 characters. |  -  |
| **401** | Unauthorized - missing or invalid API key |  -  |
| **403** | Forbidden - API key lacks the email_inboxes:create scope, or the body names a different organization |  -  |
| **409** | Conflict - the address is not available. Returned identically whether it is held by another organization or by a deleted inbox, so this endpoint cannot be used to probe which addresses exist. |  -  |
| **422** | Unprocessable - the address or the name is on the impersonation blocklist, or the name contains characters outside printable ASCII. A disallowed domain is a 400, not this. |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## deleteEmailInbox

> deleteEmailInbox(id)

Delete an email inbox

Soft-deletes the inbox and its messages in one transaction. The rows are retained and every read filters them out, so the data is recoverable — but the **address is retired permanently and can never be claimed again, by anyone including you**. Mail keeps being delivered to it, so releasing it would hand the next claimant your still-arriving messages. Requires API key with &#x60;email_inboxes:delete&#x60; scope, which is granted separately from create and update for exactly this reason.

### Example

```ts
import {
  Configuration,
  EmailInboxesApi,
} from '@programmableinbox/sdk';
import type { DeleteEmailInboxRequest } from '@programmableinbox/sdk';

async function example() {
  console.log("🚀 Testing @programmableinbox/sdk SDK...");
  const config = new Configuration({ 
    // Configure HTTP bearer authorization: ApiKeyAuth
    accessToken: "YOUR BEARER TOKEN",
  });
  const api = new EmailInboxesApi(config);

  const body = {
    // string | The email inbox ID
    id: id_example,
  } satisfies DeleteEmailInboxRequest;

  try {
    const data = await api.deleteEmailInbox(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **id** | `string` | The email inbox ID | [Defaults to `undefined`] |

### Return type

`void` (Empty response body)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **204** | Inbox deleted. No body — the record is no longer readable. |  -  |
| **401** | Unauthorized - missing or invalid API key |  -  |
| **403** | Forbidden - API key lacks the email_inboxes:delete scope. Holding create and update does not grant it. |  -  |
| **404** | Not found - no such inbox, or it is not one this key may delete. Deliberately indistinguishable. |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## getEmailInbox

> GetEmailInbox200Response getEmailInbox(id)

Get an email inbox

Returns a single email inbox by id, scoped to the organization the API key is bound to. Requires API key with &#x60;email_inboxes:read&#x60; scope.

### Example

```ts
import {
  Configuration,
  EmailInboxesApi,
} from '@programmableinbox/sdk';
import type { GetEmailInboxRequest } from '@programmableinbox/sdk';

async function example() {
  console.log("🚀 Testing @programmableinbox/sdk SDK...");
  const config = new Configuration({ 
    // Configure HTTP bearer authorization: ApiKeyAuth
    accessToken: "YOUR BEARER TOKEN",
  });
  const api = new EmailInboxesApi(config);

  const body = {
    // string | Email inbox ID
    id: id_example,
  } satisfies GetEmailInboxRequest;

  try {
    const data = await api.getEmailInbox(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **id** | `string` | Email inbox ID | [Defaults to `undefined`] |

### Return type

[**GetEmailInbox200Response**](GetEmailInbox200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | The email inbox |  -  |
| **401** | Missing, malformed or revoked API key |  -  |
| **403** | API key lacks the email_inboxes:read scope |  -  |
| **404** | No such inbox in the organization the key is bound to. Deliberately indistinguishable from an inbox that does not exist. |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## getEmailInboxMessages

> GetEmailInboxMessages200Response getEmailInboxMessages(id, cursor, limit, threadId, grouped, q, from, tags, categories)

Get messages from an email inbox

Returns messages for a specific email inbox with optional pagination and filtering. Requires API key with &#x60;email_messages:read&#x60; scope.

### Example

```ts
import {
  Configuration,
  EmailInboxesApi,
} from '@programmableinbox/sdk';
import type { GetEmailInboxMessagesRequest } from '@programmableinbox/sdk';

async function example() {
  console.log("🚀 Testing @programmableinbox/sdk SDK...");
  const config = new Configuration({ 
    // Configure HTTP bearer authorization: ApiKeyAuth
    accessToken: "YOUR BEARER TOKEN",
  });
  const api = new EmailInboxesApi(config);

  const body = {
    // string | The email inbox ID
    id: id_example,
    // string | Opaque pagination cursor from a previous response\'s nextCursor. Omit for the first page. (optional)
    cursor: cursor_example,
    // number | Number of messages per page (default: 50, max: 100) (optional)
    limit: 56,
    // string | Optional thread ID to filter messages to a specific thread (optional)
    threadId: threadId_example,
    // boolean | If true, returns only the latest message per thread (grouped view). Cannot be combined with any search parameter — the combination returns 400. (optional)
    grouped: true,
    // string | Full-text search over the subject and the message body. Supports \"quoted phrases\", `or`, and `-negation` (Postgres websearch syntax). The body searched is the plain-text `bodyText` field, which is extracted from `html` for messages that carry no text part. Results stay in reverse-chronological order — this filters, it does not rank. (optional)
    q: q_example,
    // string | Case-insensitive substring match on the sender. Matches the raw header, so it covers both the display name and the address. (optional)
    from: from_example,
    // Array<string> | Return messages carrying any of these tags (exact match, OR-combined). Repeat the parameter: tags=a&tags=b. A comma-separated single value (tags=a,b) is also accepted, but cannot express a tag that itself contains a comma. Max 20 values. (optional)
    tags: ...,
    // Array<string> | Return messages carrying any of these categories (exact match, OR-combined). Repeat the parameter: categories=a&categories=b. A comma-separated single value is also accepted, but cannot express a category that itself contains a comma. Max 20 values. (optional)
    categories: ...,
  } satisfies GetEmailInboxMessagesRequest;

  try {
    const data = await api.getEmailInboxMessages(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **id** | `string` | The email inbox ID | [Defaults to `undefined`] |
| **cursor** | `string` | Opaque pagination cursor from a previous response\&#39;s nextCursor. Omit for the first page. | [Optional] [Defaults to `undefined`] |
| **limit** | `number` | Number of messages per page (default: 50, max: 100) | [Optional] [Defaults to `undefined`] |
| **threadId** | `string` | Optional thread ID to filter messages to a specific thread | [Optional] [Defaults to `undefined`] |
| **grouped** | `boolean` | If true, returns only the latest message per thread (grouped view). Cannot be combined with any search parameter — the combination returns 400. | [Optional] [Defaults to `undefined`] |
| **q** | `string` | Full-text search over the subject and the message body. Supports \&quot;quoted phrases\&quot;, &#x60;or&#x60;, and &#x60;-negation&#x60; (Postgres websearch syntax). The body searched is the plain-text &#x60;bodyText&#x60; field, which is extracted from &#x60;html&#x60; for messages that carry no text part. Results stay in reverse-chronological order — this filters, it does not rank. | [Optional] [Defaults to `undefined`] |
| **from** | `string` | Case-insensitive substring match on the sender. Matches the raw header, so it covers both the display name and the address. | [Optional] [Defaults to `undefined`] |
| **tags** | `Array<string>` | Return messages carrying any of these tags (exact match, OR-combined). Repeat the parameter: tags&#x3D;a&amp;tags&#x3D;b. A comma-separated single value (tags&#x3D;a,b) is also accepted, but cannot express a tag that itself contains a comma. Max 20 values. | [Optional] |
| **categories** | `Array<string>` | Return messages carrying any of these categories (exact match, OR-combined). Repeat the parameter: categories&#x3D;a&amp;categories&#x3D;b. A comma-separated single value is also accepted, but cannot express a category that itself contains a comma. Max 20 values. | [Optional] |

### Return type

[**GetEmailInboxMessages200Response**](GetEmailInboxMessages200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Successfully retrieved messages |  -  |
| **400** | Invalid cursor, a search parameter over its length or value limit, or a search parameter combined with grouped&#x3D;true |  -  |
| **401** | Unauthorized - missing or invalid token/API key |  -  |
| **403** | Forbidden - user does not own inbox, API key lacks required scope (email_messages:read), or API key not authorized for this organization |  -  |
| **404** | Email inbox not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## getEmailInboxOtp

> GetEmailInboxOtp200Response getEmailInboxOtp(id)

Get the latest one-time code for an inbox

Returns the most recently extracted one-time passcode (OTP) for an email inbox, with the message it came from. Requires API key with &#x60;email_messages:read&#x60; scope — this is a read of extracted message content, not inbox metadata.

### Example

```ts
import {
  Configuration,
  EmailInboxesApi,
} from '@programmableinbox/sdk';
import type { GetEmailInboxOtpRequest } from '@programmableinbox/sdk';

async function example() {
  console.log("🚀 Testing @programmableinbox/sdk SDK...");
  const config = new Configuration({ 
    // Configure HTTP bearer authorization: ApiKeyAuth
    accessToken: "YOUR BEARER TOKEN",
  });
  const api = new EmailInboxesApi(config);

  const body = {
    // string | The email inbox ID
    id: id_example,
  } satisfies GetEmailInboxOtpRequest;

  try {
    const data = await api.getEmailInboxOtp(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **id** | `string` | The email inbox ID | [Defaults to `undefined`] |

### Return type

[**GetEmailInboxOtp200Response**](GetEmailInboxOtp200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Successfully retrieved the latest OTP |  -  |
| **401** | Unauthorized - missing or invalid API key |  -  |
| **403** | Forbidden - API key lacks required scope (email_messages:read) |  -  |
| **404** | Not found - no such inbox visible to this key, or no message with an extracted OTP has arrived for it yet |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## getEmailMessage

> GetEmailMessage200Response getEmailMessage(id, messageId)

Get a single message

Returns a specific message from an email inbox. Requires API key with &#x60;email_messages:read&#x60; scope.

### Example

```ts
import {
  Configuration,
  EmailInboxesApi,
} from '@programmableinbox/sdk';
import type { GetEmailMessageRequest } from '@programmableinbox/sdk';

async function example() {
  console.log("🚀 Testing @programmableinbox/sdk SDK...");
  const config = new Configuration({ 
    // Configure HTTP bearer authorization: ApiKeyAuth
    accessToken: "YOUR BEARER TOKEN",
  });
  const api = new EmailInboxesApi(config);

  const body = {
    // string | The email inbox ID
    id: id_example,
    // string | The message ID
    messageId: messageId_example,
  } satisfies GetEmailMessageRequest;

  try {
    const data = await api.getEmailMessage(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **id** | `string` | The email inbox ID | [Defaults to `undefined`] |
| **messageId** | `string` | The message ID | [Defaults to `undefined`] |

### Return type

[**GetEmailMessage200Response**](GetEmailMessage200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Successfully retrieved message |  -  |
| **401** | Unauthorized - missing or invalid API key |  -  |
| **403** | Forbidden - user does not own inbox, API key lacks required scope (email_messages:read), or API key not authorized for this organization |  -  |
| **404** | Message or inbox not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## listEmailInboxes

> ListEmailInboxes200Response listEmailInboxes()

List email inboxes

Returns a list of email inboxes for the organization. Requires API key with &#x60;email_inboxes:read&#x60; scope.

### Example

```ts
import {
  Configuration,
  EmailInboxesApi,
} from '@programmableinbox/sdk';
import type { ListEmailInboxesRequest } from '@programmableinbox/sdk';

async function example() {
  console.log("🚀 Testing @programmableinbox/sdk SDK...");
  const config = new Configuration({ 
    // Configure HTTP bearer authorization: ApiKeyAuth
    accessToken: "YOUR BEARER TOKEN",
  });
  const api = new EmailInboxesApi(config);

  try {
    const data = await api.listEmailInboxes();
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters

This endpoint does not need any parameter.

### Return type

[**ListEmailInboxes200Response**](ListEmailInboxes200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Successfully retrieved email inboxes |  -  |
| **401** | Unauthorized - missing or invalid token/API key |  -  |
| **403** | Forbidden - API key lacks required scope (email_inboxes:read) |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## updateEmailInbox

> CreateEmailInbox201Response updateEmailInbox(id, updateEmailInboxRequest)

Rename an email inbox

Updates an inbox display name. The address is immutable — submitting a different one is a 409; submitting the current one (after normalization) is an allowed no-op, so a client can PATCH a whole record back. Requires API key with &#x60;email_inboxes:update&#x60; scope.

### Example

```ts
import {
  Configuration,
  EmailInboxesApi,
} from '@programmableinbox/sdk';
import type { UpdateEmailInboxOperationRequest } from '@programmableinbox/sdk';

async function example() {
  console.log("🚀 Testing @programmableinbox/sdk SDK...");
  const config = new Configuration({ 
    // Configure HTTP bearer authorization: ApiKeyAuth
    accessToken: "YOUR BEARER TOKEN",
  });
  const api = new EmailInboxesApi(config);

  const body = {
    // string | The email inbox ID
    id: id_example,
    // UpdateEmailInboxRequest
    updateEmailInboxRequest: ...,
  } satisfies UpdateEmailInboxOperationRequest;

  try {
    const data = await api.updateEmailInbox(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **id** | `string` | The email inbox ID | [Defaults to `undefined`] |
| **updateEmailInboxRequest** | [UpdateEmailInboxRequest](UpdateEmailInboxRequest.md) |  | |

### Return type

[**CreateEmailInbox201Response**](CreateEmailInbox201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


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

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)

