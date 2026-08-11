# EmailInboxesApi

All URIs are relative to *https://app.programmableinbox.com*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**createEmailInbox**](EmailInboxesApi.md#createEmailInbox) | **POST** /api/v1/emailInbox | Create an email inbox |
| [**createEmailInboxWithHttpInfo**](EmailInboxesApi.md#createEmailInboxWithHttpInfo) | **POST** /api/v1/emailInbox | Create an email inbox |
| [**deleteEmailInbox**](EmailInboxesApi.md#deleteEmailInbox) | **DELETE** /api/v1/emailInbox/{id} | Delete an email inbox |
| [**deleteEmailInboxWithHttpInfo**](EmailInboxesApi.md#deleteEmailInboxWithHttpInfo) | **DELETE** /api/v1/emailInbox/{id} | Delete an email inbox |
| [**getEmailInbox**](EmailInboxesApi.md#getEmailInbox) | **GET** /api/v1/emailInbox/{id} | Get an email inbox |
| [**getEmailInboxWithHttpInfo**](EmailInboxesApi.md#getEmailInboxWithHttpInfo) | **GET** /api/v1/emailInbox/{id} | Get an email inbox |
| [**getEmailInboxMessages**](EmailInboxesApi.md#getEmailInboxMessages) | **GET** /api/v1/emailInbox/{id}/messages | Get messages from an email inbox |
| [**getEmailInboxMessagesWithHttpInfo**](EmailInboxesApi.md#getEmailInboxMessagesWithHttpInfo) | **GET** /api/v1/emailInbox/{id}/messages | Get messages from an email inbox |
| [**getEmailMessage**](EmailInboxesApi.md#getEmailMessage) | **GET** /api/v1/emailInbox/{id}/messages/{messageId} | Get a single message |
| [**getEmailMessageWithHttpInfo**](EmailInboxesApi.md#getEmailMessageWithHttpInfo) | **GET** /api/v1/emailInbox/{id}/messages/{messageId} | Get a single message |
| [**listEmailInboxes**](EmailInboxesApi.md#listEmailInboxes) | **GET** /api/v1/emailInbox | List email inboxes |
| [**listEmailInboxesWithHttpInfo**](EmailInboxesApi.md#listEmailInboxesWithHttpInfo) | **GET** /api/v1/emailInbox | List email inboxes |
| [**updateEmailInbox**](EmailInboxesApi.md#updateEmailInbox) | **PATCH** /api/v1/emailInbox/{id} | Rename an email inbox |
| [**updateEmailInboxWithHttpInfo**](EmailInboxesApi.md#updateEmailInboxWithHttpInfo) | **PATCH** /api/v1/emailInbox/{id} | Rename an email inbox |



## createEmailInbox

> CreateEmailInbox201Response createEmailInbox(createEmailInboxRequest)

Create an email inbox

Claims a new email address and returns the inbox. The address must be on a domain this account can receive at, and is immutable once created. Requires API key with &#x60;email_inboxes:create&#x60; scope. The inbox is created in the organization the key is bound to; supplying a different &#x60;organizationId&#x60; is a 403 rather than a silently ignored field.

### Example

```java
// Import classes:
import com.programmableinbox.sdk.ApiClient;
import com.programmableinbox.sdk.ApiException;
import com.programmableinbox.sdk.Configuration;
import com.programmableinbox.sdk.auth.*;
import com.programmableinbox.sdk.models.*;
import com.programmableinbox.sdk.api.EmailInboxesApi;

public class Example {
    public static void main(String[] args) {
        ApiClient defaultClient = Configuration.getDefaultApiClient();
        defaultClient.setBasePath("https://app.programmableinbox.com");
        
        // Configure HTTP bearer authorization: ApiKeyAuth
        HttpBearerAuth ApiKeyAuth = (HttpBearerAuth) defaultClient.getAuthentication("ApiKeyAuth");
        ApiKeyAuth.setBearerToken("BEARER TOKEN");

        EmailInboxesApi apiInstance = new EmailInboxesApi(defaultClient);
        CreateEmailInboxRequest createEmailInboxRequest = new CreateEmailInboxRequest(); // CreateEmailInboxRequest | 
        try {
            CreateEmailInbox201Response result = apiInstance.createEmailInbox(createEmailInboxRequest);
            System.out.println(result);
        } catch (ApiException e) {
            System.err.println("Exception when calling EmailInboxesApi#createEmailInbox");
            System.err.println("Status code: " + e.getCode());
            System.err.println("Reason: " + e.getResponseBody());
            System.err.println("Response headers: " + e.getResponseHeaders());
            e.printStackTrace();
        }
    }
}
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **createEmailInboxRequest** | [**CreateEmailInboxRequest**](CreateEmailInboxRequest.md)|  | |

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
| **403** | Forbidden - API key lacks the email_inboxes:create scope, or the body names a different organization |  -  |
| **409** | Conflict - the address is not available. Returned identically whether it is held by another organization or by a deleted inbox, so this endpoint cannot be used to probe which addresses exist. |  -  |
| **422** | Unprocessable - the address or the name is on the impersonation blocklist, or the name contains characters outside printable ASCII. A disallowed domain is a 400, not this. |  -  |

## createEmailInboxWithHttpInfo

> ApiResponse<CreateEmailInbox201Response> createEmailInboxWithHttpInfo(createEmailInboxRequest)

Create an email inbox

Claims a new email address and returns the inbox. The address must be on a domain this account can receive at, and is immutable once created. Requires API key with &#x60;email_inboxes:create&#x60; scope. The inbox is created in the organization the key is bound to; supplying a different &#x60;organizationId&#x60; is a 403 rather than a silently ignored field.

### Example

```java
// Import classes:
import com.programmableinbox.sdk.ApiClient;
import com.programmableinbox.sdk.ApiException;
import com.programmableinbox.sdk.ApiResponse;
import com.programmableinbox.sdk.Configuration;
import com.programmableinbox.sdk.auth.*;
import com.programmableinbox.sdk.models.*;
import com.programmableinbox.sdk.api.EmailInboxesApi;

public class Example {
    public static void main(String[] args) {
        ApiClient defaultClient = Configuration.getDefaultApiClient();
        defaultClient.setBasePath("https://app.programmableinbox.com");
        
        // Configure HTTP bearer authorization: ApiKeyAuth
        HttpBearerAuth ApiKeyAuth = (HttpBearerAuth) defaultClient.getAuthentication("ApiKeyAuth");
        ApiKeyAuth.setBearerToken("BEARER TOKEN");

        EmailInboxesApi apiInstance = new EmailInboxesApi(defaultClient);
        CreateEmailInboxRequest createEmailInboxRequest = new CreateEmailInboxRequest(); // CreateEmailInboxRequest | 
        try {
            ApiResponse<CreateEmailInbox201Response> response = apiInstance.createEmailInboxWithHttpInfo(createEmailInboxRequest);
            System.out.println("Status code: " + response.getStatusCode());
            System.out.println("Response headers: " + response.getHeaders());
            System.out.println("Response body: " + response.getData());
        } catch (ApiException e) {
            System.err.println("Exception when calling EmailInboxesApi#createEmailInbox");
            System.err.println("Status code: " + e.getCode());
            System.err.println("Response headers: " + e.getResponseHeaders());
            System.err.println("Reason: " + e.getResponseBody());
            e.printStackTrace();
        }
    }
}
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **createEmailInboxRequest** | [**CreateEmailInboxRequest**](CreateEmailInboxRequest.md)|  | |

### Return type

ApiResponse<[**CreateEmailInbox201Response**](CreateEmailInbox201Response.md)>


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
| **403** | Forbidden - API key lacks the email_inboxes:create scope, or the body names a different organization |  -  |
| **409** | Conflict - the address is not available. Returned identically whether it is held by another organization or by a deleted inbox, so this endpoint cannot be used to probe which addresses exist. |  -  |
| **422** | Unprocessable - the address or the name is on the impersonation blocklist, or the name contains characters outside printable ASCII. A disallowed domain is a 400, not this. |  -  |


## deleteEmailInbox

> void deleteEmailInbox(id)

Delete an email inbox

Soft-deletes the inbox and its messages in one transaction. The rows are retained and every read filters them out, so the data is recoverable — but the **address is retired permanently and can never be claimed again, by anyone including you**. Mail keeps being delivered to it, so releasing it would hand the next claimant your still-arriving messages. Requires API key with &#x60;email_inboxes:delete&#x60; scope, which is granted separately from create and update for exactly this reason.

### Example

```java
// Import classes:
import com.programmableinbox.sdk.ApiClient;
import com.programmableinbox.sdk.ApiException;
import com.programmableinbox.sdk.Configuration;
import com.programmableinbox.sdk.auth.*;
import com.programmableinbox.sdk.models.*;
import com.programmableinbox.sdk.api.EmailInboxesApi;

public class Example {
    public static void main(String[] args) {
        ApiClient defaultClient = Configuration.getDefaultApiClient();
        defaultClient.setBasePath("https://app.programmableinbox.com");
        
        // Configure HTTP bearer authorization: ApiKeyAuth
        HttpBearerAuth ApiKeyAuth = (HttpBearerAuth) defaultClient.getAuthentication("ApiKeyAuth");
        ApiKeyAuth.setBearerToken("BEARER TOKEN");

        EmailInboxesApi apiInstance = new EmailInboxesApi(defaultClient);
        String id = "id_example"; // String | The email inbox ID
        try {
            apiInstance.deleteEmailInbox(id);
        } catch (ApiException e) {
            System.err.println("Exception when calling EmailInboxesApi#deleteEmailInbox");
            System.err.println("Status code: " + e.getCode());
            System.err.println("Reason: " + e.getResponseBody());
            System.err.println("Response headers: " + e.getResponseHeaders());
            e.printStackTrace();
        }
    }
}
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **id** | **String**| The email inbox ID | |

### Return type


null (empty response body)

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

## deleteEmailInboxWithHttpInfo

> ApiResponse<Void> deleteEmailInboxWithHttpInfo(id)

Delete an email inbox

Soft-deletes the inbox and its messages in one transaction. The rows are retained and every read filters them out, so the data is recoverable — but the **address is retired permanently and can never be claimed again, by anyone including you**. Mail keeps being delivered to it, so releasing it would hand the next claimant your still-arriving messages. Requires API key with &#x60;email_inboxes:delete&#x60; scope, which is granted separately from create and update for exactly this reason.

### Example

```java
// Import classes:
import com.programmableinbox.sdk.ApiClient;
import com.programmableinbox.sdk.ApiException;
import com.programmableinbox.sdk.ApiResponse;
import com.programmableinbox.sdk.Configuration;
import com.programmableinbox.sdk.auth.*;
import com.programmableinbox.sdk.models.*;
import com.programmableinbox.sdk.api.EmailInboxesApi;

public class Example {
    public static void main(String[] args) {
        ApiClient defaultClient = Configuration.getDefaultApiClient();
        defaultClient.setBasePath("https://app.programmableinbox.com");
        
        // Configure HTTP bearer authorization: ApiKeyAuth
        HttpBearerAuth ApiKeyAuth = (HttpBearerAuth) defaultClient.getAuthentication("ApiKeyAuth");
        ApiKeyAuth.setBearerToken("BEARER TOKEN");

        EmailInboxesApi apiInstance = new EmailInboxesApi(defaultClient);
        String id = "id_example"; // String | The email inbox ID
        try {
            ApiResponse<Void> response = apiInstance.deleteEmailInboxWithHttpInfo(id);
            System.out.println("Status code: " + response.getStatusCode());
            System.out.println("Response headers: " + response.getHeaders());
        } catch (ApiException e) {
            System.err.println("Exception when calling EmailInboxesApi#deleteEmailInbox");
            System.err.println("Status code: " + e.getCode());
            System.err.println("Response headers: " + e.getResponseHeaders());
            System.err.println("Reason: " + e.getResponseBody());
            e.printStackTrace();
        }
    }
}
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **id** | **String**| The email inbox ID | |

### Return type


ApiResponse<Void>

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


## getEmailInbox

> GetEmailInbox200Response getEmailInbox(id)

Get an email inbox

Returns a single email inbox by id, scoped to the organization the API key is bound to. Requires API key with &#x60;email_inboxes:read&#x60; scope.

### Example

```java
// Import classes:
import com.programmableinbox.sdk.ApiClient;
import com.programmableinbox.sdk.ApiException;
import com.programmableinbox.sdk.Configuration;
import com.programmableinbox.sdk.auth.*;
import com.programmableinbox.sdk.models.*;
import com.programmableinbox.sdk.api.EmailInboxesApi;

public class Example {
    public static void main(String[] args) {
        ApiClient defaultClient = Configuration.getDefaultApiClient();
        defaultClient.setBasePath("https://app.programmableinbox.com");
        
        // Configure HTTP bearer authorization: ApiKeyAuth
        HttpBearerAuth ApiKeyAuth = (HttpBearerAuth) defaultClient.getAuthentication("ApiKeyAuth");
        ApiKeyAuth.setBearerToken("BEARER TOKEN");

        EmailInboxesApi apiInstance = new EmailInboxesApi(defaultClient);
        String id = "id_example"; // String | Email inbox ID
        try {
            GetEmailInbox200Response result = apiInstance.getEmailInbox(id);
            System.out.println(result);
        } catch (ApiException e) {
            System.err.println("Exception when calling EmailInboxesApi#getEmailInbox");
            System.err.println("Status code: " + e.getCode());
            System.err.println("Reason: " + e.getResponseBody());
            System.err.println("Response headers: " + e.getResponseHeaders());
            e.printStackTrace();
        }
    }
}
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **id** | **String**| Email inbox ID | |

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

## getEmailInboxWithHttpInfo

> ApiResponse<GetEmailInbox200Response> getEmailInboxWithHttpInfo(id)

Get an email inbox

Returns a single email inbox by id, scoped to the organization the API key is bound to. Requires API key with &#x60;email_inboxes:read&#x60; scope.

### Example

```java
// Import classes:
import com.programmableinbox.sdk.ApiClient;
import com.programmableinbox.sdk.ApiException;
import com.programmableinbox.sdk.ApiResponse;
import com.programmableinbox.sdk.Configuration;
import com.programmableinbox.sdk.auth.*;
import com.programmableinbox.sdk.models.*;
import com.programmableinbox.sdk.api.EmailInboxesApi;

public class Example {
    public static void main(String[] args) {
        ApiClient defaultClient = Configuration.getDefaultApiClient();
        defaultClient.setBasePath("https://app.programmableinbox.com");
        
        // Configure HTTP bearer authorization: ApiKeyAuth
        HttpBearerAuth ApiKeyAuth = (HttpBearerAuth) defaultClient.getAuthentication("ApiKeyAuth");
        ApiKeyAuth.setBearerToken("BEARER TOKEN");

        EmailInboxesApi apiInstance = new EmailInboxesApi(defaultClient);
        String id = "id_example"; // String | Email inbox ID
        try {
            ApiResponse<GetEmailInbox200Response> response = apiInstance.getEmailInboxWithHttpInfo(id);
            System.out.println("Status code: " + response.getStatusCode());
            System.out.println("Response headers: " + response.getHeaders());
            System.out.println("Response body: " + response.getData());
        } catch (ApiException e) {
            System.err.println("Exception when calling EmailInboxesApi#getEmailInbox");
            System.err.println("Status code: " + e.getCode());
            System.err.println("Response headers: " + e.getResponseHeaders());
            System.err.println("Reason: " + e.getResponseBody());
            e.printStackTrace();
        }
    }
}
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **id** | **String**| Email inbox ID | |

### Return type

ApiResponse<[**GetEmailInbox200Response**](GetEmailInbox200Response.md)>


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


## getEmailInboxMessages

> GetEmailInboxMessages200Response getEmailInboxMessages(id, cursor, limit, threadId, grouped, q, from, tags, categories)

Get messages from an email inbox

Returns messages for a specific email inbox with optional pagination and filtering. Requires API key with &#x60;email_messages:read&#x60; scope.

### Example

```java
// Import classes:
import com.programmableinbox.sdk.ApiClient;
import com.programmableinbox.sdk.ApiException;
import com.programmableinbox.sdk.Configuration;
import com.programmableinbox.sdk.auth.*;
import com.programmableinbox.sdk.models.*;
import com.programmableinbox.sdk.api.EmailInboxesApi;

public class Example {
    public static void main(String[] args) {
        ApiClient defaultClient = Configuration.getDefaultApiClient();
        defaultClient.setBasePath("https://app.programmableinbox.com");
        
        // Configure HTTP bearer authorization: ApiKeyAuth
        HttpBearerAuth ApiKeyAuth = (HttpBearerAuth) defaultClient.getAuthentication("ApiKeyAuth");
        ApiKeyAuth.setBearerToken("BEARER TOKEN");

        EmailInboxesApi apiInstance = new EmailInboxesApi(defaultClient);
        String id = "id_example"; // String | The email inbox ID
        String cursor = "cursor_example"; // String | Opaque pagination cursor from a previous response's nextCursor. Omit for the first page.
        Integer limit = 56; // Integer | Number of messages per page (default: 50, max: 100)
        String threadId = "threadId_example"; // String | Optional thread ID to filter messages to a specific thread
        Boolean grouped = true; // Boolean | If true, returns only the latest message per thread (grouped view). Cannot be combined with any search parameter — the combination returns 400.
        String q = "\"order confirmed\" -refund"; // String | Full-text search over the subject and the message body. Supports \"quoted phrases\", `or`, and `-negation` (Postgres websearch syntax). The body searched is the plain-text `bodyText` field, which is extracted from `html` for messages that carry no text part. Results stay in reverse-chronological order — this filters, it does not rank.
        String from = "billing@acme.com"; // String | Case-insensitive substring match on the sender. Matches the raw header, so it covers both the display name and the address.
        List<String> tags = Arrays.asList(); // List<String> | Return messages carrying any of these tags (exact match, OR-combined). Repeat the parameter: tags=a&tags=b. A comma-separated single value (tags=a,b) is also accepted, but cannot express a tag that itself contains a comma. Max 20 values.
        List<String> categories = Arrays.asList(); // List<String> | Return messages carrying any of these categories (exact match, OR-combined). Repeat the parameter: categories=a&categories=b. A comma-separated single value is also accepted, but cannot express a category that itself contains a comma. Max 20 values.
        try {
            GetEmailInboxMessages200Response result = apiInstance.getEmailInboxMessages(id, cursor, limit, threadId, grouped, q, from, tags, categories);
            System.out.println(result);
        } catch (ApiException e) {
            System.err.println("Exception when calling EmailInboxesApi#getEmailInboxMessages");
            System.err.println("Status code: " + e.getCode());
            System.err.println("Reason: " + e.getResponseBody());
            System.err.println("Response headers: " + e.getResponseHeaders());
            e.printStackTrace();
        }
    }
}
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **id** | **String**| The email inbox ID | |
| **cursor** | **String**| Opaque pagination cursor from a previous response&#39;s nextCursor. Omit for the first page. | [optional] |
| **limit** | **Integer**| Number of messages per page (default: 50, max: 100) | [optional] |
| **threadId** | **String**| Optional thread ID to filter messages to a specific thread | [optional] |
| **grouped** | **Boolean**| If true, returns only the latest message per thread (grouped view). Cannot be combined with any search parameter — the combination returns 400. | [optional] |
| **q** | **String**| Full-text search over the subject and the message body. Supports \&quot;quoted phrases\&quot;, &#x60;or&#x60;, and &#x60;-negation&#x60; (Postgres websearch syntax). The body searched is the plain-text &#x60;bodyText&#x60; field, which is extracted from &#x60;html&#x60; for messages that carry no text part. Results stay in reverse-chronological order — this filters, it does not rank. | [optional] |
| **from** | **String**| Case-insensitive substring match on the sender. Matches the raw header, so it covers both the display name and the address. | [optional] |
| **tags** | [**List&lt;String&gt;**](String.md)| Return messages carrying any of these tags (exact match, OR-combined). Repeat the parameter: tags&#x3D;a&amp;tags&#x3D;b. A comma-separated single value (tags&#x3D;a,b) is also accepted, but cannot express a tag that itself contains a comma. Max 20 values. | [optional] |
| **categories** | [**List&lt;String&gt;**](String.md)| Return messages carrying any of these categories (exact match, OR-combined). Repeat the parameter: categories&#x3D;a&amp;categories&#x3D;b. A comma-separated single value is also accepted, but cannot express a category that itself contains a comma. Max 20 values. | [optional] |

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

## getEmailInboxMessagesWithHttpInfo

> ApiResponse<GetEmailInboxMessages200Response> getEmailInboxMessagesWithHttpInfo(id, cursor, limit, threadId, grouped, q, from, tags, categories)

Get messages from an email inbox

Returns messages for a specific email inbox with optional pagination and filtering. Requires API key with &#x60;email_messages:read&#x60; scope.

### Example

```java
// Import classes:
import com.programmableinbox.sdk.ApiClient;
import com.programmableinbox.sdk.ApiException;
import com.programmableinbox.sdk.ApiResponse;
import com.programmableinbox.sdk.Configuration;
import com.programmableinbox.sdk.auth.*;
import com.programmableinbox.sdk.models.*;
import com.programmableinbox.sdk.api.EmailInboxesApi;

public class Example {
    public static void main(String[] args) {
        ApiClient defaultClient = Configuration.getDefaultApiClient();
        defaultClient.setBasePath("https://app.programmableinbox.com");
        
        // Configure HTTP bearer authorization: ApiKeyAuth
        HttpBearerAuth ApiKeyAuth = (HttpBearerAuth) defaultClient.getAuthentication("ApiKeyAuth");
        ApiKeyAuth.setBearerToken("BEARER TOKEN");

        EmailInboxesApi apiInstance = new EmailInboxesApi(defaultClient);
        String id = "id_example"; // String | The email inbox ID
        String cursor = "cursor_example"; // String | Opaque pagination cursor from a previous response's nextCursor. Omit for the first page.
        Integer limit = 56; // Integer | Number of messages per page (default: 50, max: 100)
        String threadId = "threadId_example"; // String | Optional thread ID to filter messages to a specific thread
        Boolean grouped = true; // Boolean | If true, returns only the latest message per thread (grouped view). Cannot be combined with any search parameter — the combination returns 400.
        String q = "\"order confirmed\" -refund"; // String | Full-text search over the subject and the message body. Supports \"quoted phrases\", `or`, and `-negation` (Postgres websearch syntax). The body searched is the plain-text `bodyText` field, which is extracted from `html` for messages that carry no text part. Results stay in reverse-chronological order — this filters, it does not rank.
        String from = "billing@acme.com"; // String | Case-insensitive substring match on the sender. Matches the raw header, so it covers both the display name and the address.
        List<String> tags = Arrays.asList(); // List<String> | Return messages carrying any of these tags (exact match, OR-combined). Repeat the parameter: tags=a&tags=b. A comma-separated single value (tags=a,b) is also accepted, but cannot express a tag that itself contains a comma. Max 20 values.
        List<String> categories = Arrays.asList(); // List<String> | Return messages carrying any of these categories (exact match, OR-combined). Repeat the parameter: categories=a&categories=b. A comma-separated single value is also accepted, but cannot express a category that itself contains a comma. Max 20 values.
        try {
            ApiResponse<GetEmailInboxMessages200Response> response = apiInstance.getEmailInboxMessagesWithHttpInfo(id, cursor, limit, threadId, grouped, q, from, tags, categories);
            System.out.println("Status code: " + response.getStatusCode());
            System.out.println("Response headers: " + response.getHeaders());
            System.out.println("Response body: " + response.getData());
        } catch (ApiException e) {
            System.err.println("Exception when calling EmailInboxesApi#getEmailInboxMessages");
            System.err.println("Status code: " + e.getCode());
            System.err.println("Response headers: " + e.getResponseHeaders());
            System.err.println("Reason: " + e.getResponseBody());
            e.printStackTrace();
        }
    }
}
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **id** | **String**| The email inbox ID | |
| **cursor** | **String**| Opaque pagination cursor from a previous response&#39;s nextCursor. Omit for the first page. | [optional] |
| **limit** | **Integer**| Number of messages per page (default: 50, max: 100) | [optional] |
| **threadId** | **String**| Optional thread ID to filter messages to a specific thread | [optional] |
| **grouped** | **Boolean**| If true, returns only the latest message per thread (grouped view). Cannot be combined with any search parameter — the combination returns 400. | [optional] |
| **q** | **String**| Full-text search over the subject and the message body. Supports \&quot;quoted phrases\&quot;, &#x60;or&#x60;, and &#x60;-negation&#x60; (Postgres websearch syntax). The body searched is the plain-text &#x60;bodyText&#x60; field, which is extracted from &#x60;html&#x60; for messages that carry no text part. Results stay in reverse-chronological order — this filters, it does not rank. | [optional] |
| **from** | **String**| Case-insensitive substring match on the sender. Matches the raw header, so it covers both the display name and the address. | [optional] |
| **tags** | [**List&lt;String&gt;**](String.md)| Return messages carrying any of these tags (exact match, OR-combined). Repeat the parameter: tags&#x3D;a&amp;tags&#x3D;b. A comma-separated single value (tags&#x3D;a,b) is also accepted, but cannot express a tag that itself contains a comma. Max 20 values. | [optional] |
| **categories** | [**List&lt;String&gt;**](String.md)| Return messages carrying any of these categories (exact match, OR-combined). Repeat the parameter: categories&#x3D;a&amp;categories&#x3D;b. A comma-separated single value is also accepted, but cannot express a category that itself contains a comma. Max 20 values. | [optional] |

### Return type

ApiResponse<[**GetEmailInboxMessages200Response**](GetEmailInboxMessages200Response.md)>


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


## getEmailMessage

> GetEmailMessage200Response getEmailMessage(id, messageId)

Get a single message

Returns a specific message from an email inbox. Requires API key with &#x60;email_messages:read&#x60; scope.

### Example

```java
// Import classes:
import com.programmableinbox.sdk.ApiClient;
import com.programmableinbox.sdk.ApiException;
import com.programmableinbox.sdk.Configuration;
import com.programmableinbox.sdk.auth.*;
import com.programmableinbox.sdk.models.*;
import com.programmableinbox.sdk.api.EmailInboxesApi;

public class Example {
    public static void main(String[] args) {
        ApiClient defaultClient = Configuration.getDefaultApiClient();
        defaultClient.setBasePath("https://app.programmableinbox.com");
        
        // Configure HTTP bearer authorization: ApiKeyAuth
        HttpBearerAuth ApiKeyAuth = (HttpBearerAuth) defaultClient.getAuthentication("ApiKeyAuth");
        ApiKeyAuth.setBearerToken("BEARER TOKEN");

        EmailInboxesApi apiInstance = new EmailInboxesApi(defaultClient);
        String id = "id_example"; // String | The email inbox ID
        String messageId = "messageId_example"; // String | The message ID
        try {
            GetEmailMessage200Response result = apiInstance.getEmailMessage(id, messageId);
            System.out.println(result);
        } catch (ApiException e) {
            System.err.println("Exception when calling EmailInboxesApi#getEmailMessage");
            System.err.println("Status code: " + e.getCode());
            System.err.println("Reason: " + e.getResponseBody());
            System.err.println("Response headers: " + e.getResponseHeaders());
            e.printStackTrace();
        }
    }
}
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **id** | **String**| The email inbox ID | |
| **messageId** | **String**| The message ID | |

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

## getEmailMessageWithHttpInfo

> ApiResponse<GetEmailMessage200Response> getEmailMessageWithHttpInfo(id, messageId)

Get a single message

Returns a specific message from an email inbox. Requires API key with &#x60;email_messages:read&#x60; scope.

### Example

```java
// Import classes:
import com.programmableinbox.sdk.ApiClient;
import com.programmableinbox.sdk.ApiException;
import com.programmableinbox.sdk.ApiResponse;
import com.programmableinbox.sdk.Configuration;
import com.programmableinbox.sdk.auth.*;
import com.programmableinbox.sdk.models.*;
import com.programmableinbox.sdk.api.EmailInboxesApi;

public class Example {
    public static void main(String[] args) {
        ApiClient defaultClient = Configuration.getDefaultApiClient();
        defaultClient.setBasePath("https://app.programmableinbox.com");
        
        // Configure HTTP bearer authorization: ApiKeyAuth
        HttpBearerAuth ApiKeyAuth = (HttpBearerAuth) defaultClient.getAuthentication("ApiKeyAuth");
        ApiKeyAuth.setBearerToken("BEARER TOKEN");

        EmailInboxesApi apiInstance = new EmailInboxesApi(defaultClient);
        String id = "id_example"; // String | The email inbox ID
        String messageId = "messageId_example"; // String | The message ID
        try {
            ApiResponse<GetEmailMessage200Response> response = apiInstance.getEmailMessageWithHttpInfo(id, messageId);
            System.out.println("Status code: " + response.getStatusCode());
            System.out.println("Response headers: " + response.getHeaders());
            System.out.println("Response body: " + response.getData());
        } catch (ApiException e) {
            System.err.println("Exception when calling EmailInboxesApi#getEmailMessage");
            System.err.println("Status code: " + e.getCode());
            System.err.println("Response headers: " + e.getResponseHeaders());
            System.err.println("Reason: " + e.getResponseBody());
            e.printStackTrace();
        }
    }
}
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **id** | **String**| The email inbox ID | |
| **messageId** | **String**| The message ID | |

### Return type

ApiResponse<[**GetEmailMessage200Response**](GetEmailMessage200Response.md)>


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


## listEmailInboxes

> ListEmailInboxes200Response listEmailInboxes(organizationId)

List email inboxes

Returns a list of email inboxes for the organization. Requires API key with &#x60;email_inboxes:read&#x60; scope.

### Example

```java
// Import classes:
import com.programmableinbox.sdk.ApiClient;
import com.programmableinbox.sdk.ApiException;
import com.programmableinbox.sdk.Configuration;
import com.programmableinbox.sdk.auth.*;
import com.programmableinbox.sdk.models.*;
import com.programmableinbox.sdk.api.EmailInboxesApi;

public class Example {
    public static void main(String[] args) {
        ApiClient defaultClient = Configuration.getDefaultApiClient();
        defaultClient.setBasePath("https://app.programmableinbox.com");
        
        // Configure HTTP bearer authorization: ApiKeyAuth
        HttpBearerAuth ApiKeyAuth = (HttpBearerAuth) defaultClient.getAuthentication("ApiKeyAuth");
        ApiKeyAuth.setBearerToken("BEARER TOKEN");

        EmailInboxesApi apiInstance = new EmailInboxesApi(defaultClient);
        String organizationId = "organizationId_example"; // String | Optional organization ID to filter inboxes. User must be a member of the organization, or API key must belong to this organization.
        try {
            ListEmailInboxes200Response result = apiInstance.listEmailInboxes(organizationId);
            System.out.println(result);
        } catch (ApiException e) {
            System.err.println("Exception when calling EmailInboxesApi#listEmailInboxes");
            System.err.println("Status code: " + e.getCode());
            System.err.println("Reason: " + e.getResponseBody());
            System.err.println("Response headers: " + e.getResponseHeaders());
            e.printStackTrace();
        }
    }
}
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **organizationId** | **String**| Optional organization ID to filter inboxes. User must be a member of the organization, or API key must belong to this organization. | [optional] |

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
| **403** | Forbidden - user not member of organization or API key lacks required scope (email_inboxes:read) |  -  |

## listEmailInboxesWithHttpInfo

> ApiResponse<ListEmailInboxes200Response> listEmailInboxesWithHttpInfo(organizationId)

List email inboxes

Returns a list of email inboxes for the organization. Requires API key with &#x60;email_inboxes:read&#x60; scope.

### Example

```java
// Import classes:
import com.programmableinbox.sdk.ApiClient;
import com.programmableinbox.sdk.ApiException;
import com.programmableinbox.sdk.ApiResponse;
import com.programmableinbox.sdk.Configuration;
import com.programmableinbox.sdk.auth.*;
import com.programmableinbox.sdk.models.*;
import com.programmableinbox.sdk.api.EmailInboxesApi;

public class Example {
    public static void main(String[] args) {
        ApiClient defaultClient = Configuration.getDefaultApiClient();
        defaultClient.setBasePath("https://app.programmableinbox.com");
        
        // Configure HTTP bearer authorization: ApiKeyAuth
        HttpBearerAuth ApiKeyAuth = (HttpBearerAuth) defaultClient.getAuthentication("ApiKeyAuth");
        ApiKeyAuth.setBearerToken("BEARER TOKEN");

        EmailInboxesApi apiInstance = new EmailInboxesApi(defaultClient);
        String organizationId = "organizationId_example"; // String | Optional organization ID to filter inboxes. User must be a member of the organization, or API key must belong to this organization.
        try {
            ApiResponse<ListEmailInboxes200Response> response = apiInstance.listEmailInboxesWithHttpInfo(organizationId);
            System.out.println("Status code: " + response.getStatusCode());
            System.out.println("Response headers: " + response.getHeaders());
            System.out.println("Response body: " + response.getData());
        } catch (ApiException e) {
            System.err.println("Exception when calling EmailInboxesApi#listEmailInboxes");
            System.err.println("Status code: " + e.getCode());
            System.err.println("Response headers: " + e.getResponseHeaders());
            System.err.println("Reason: " + e.getResponseBody());
            e.printStackTrace();
        }
    }
}
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **organizationId** | **String**| Optional organization ID to filter inboxes. User must be a member of the organization, or API key must belong to this organization. | [optional] |

### Return type

ApiResponse<[**ListEmailInboxes200Response**](ListEmailInboxes200Response.md)>


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
| **403** | Forbidden - user not member of organization or API key lacks required scope (email_inboxes:read) |  -  |


## updateEmailInbox

> CreateEmailInbox201Response updateEmailInbox(id, updateEmailInboxRequest)

Rename an email inbox

Updates an inbox display name. The address is immutable — submitting a different one is a 409; submitting the current one (after normalization) is an allowed no-op, so a client can PATCH a whole record back. Requires API key with &#x60;email_inboxes:update&#x60; scope.

### Example

```java
// Import classes:
import com.programmableinbox.sdk.ApiClient;
import com.programmableinbox.sdk.ApiException;
import com.programmableinbox.sdk.Configuration;
import com.programmableinbox.sdk.auth.*;
import com.programmableinbox.sdk.models.*;
import com.programmableinbox.sdk.api.EmailInboxesApi;

public class Example {
    public static void main(String[] args) {
        ApiClient defaultClient = Configuration.getDefaultApiClient();
        defaultClient.setBasePath("https://app.programmableinbox.com");
        
        // Configure HTTP bearer authorization: ApiKeyAuth
        HttpBearerAuth ApiKeyAuth = (HttpBearerAuth) defaultClient.getAuthentication("ApiKeyAuth");
        ApiKeyAuth.setBearerToken("BEARER TOKEN");

        EmailInboxesApi apiInstance = new EmailInboxesApi(defaultClient);
        String id = "id_example"; // String | The email inbox ID
        UpdateEmailInboxRequest updateEmailInboxRequest = new UpdateEmailInboxRequest(); // UpdateEmailInboxRequest | 
        try {
            CreateEmailInbox201Response result = apiInstance.updateEmailInbox(id, updateEmailInboxRequest);
            System.out.println(result);
        } catch (ApiException e) {
            System.err.println("Exception when calling EmailInboxesApi#updateEmailInbox");
            System.err.println("Status code: " + e.getCode());
            System.err.println("Reason: " + e.getResponseBody());
            System.err.println("Response headers: " + e.getResponseHeaders());
            e.printStackTrace();
        }
    }
}
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **id** | **String**| The email inbox ID | |
| **updateEmailInboxRequest** | [**UpdateEmailInboxRequest**](UpdateEmailInboxRequest.md)|  | |

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

## updateEmailInboxWithHttpInfo

> ApiResponse<CreateEmailInbox201Response> updateEmailInboxWithHttpInfo(id, updateEmailInboxRequest)

Rename an email inbox

Updates an inbox display name. The address is immutable — submitting a different one is a 409; submitting the current one (after normalization) is an allowed no-op, so a client can PATCH a whole record back. Requires API key with &#x60;email_inboxes:update&#x60; scope.

### Example

```java
// Import classes:
import com.programmableinbox.sdk.ApiClient;
import com.programmableinbox.sdk.ApiException;
import com.programmableinbox.sdk.ApiResponse;
import com.programmableinbox.sdk.Configuration;
import com.programmableinbox.sdk.auth.*;
import com.programmableinbox.sdk.models.*;
import com.programmableinbox.sdk.api.EmailInboxesApi;

public class Example {
    public static void main(String[] args) {
        ApiClient defaultClient = Configuration.getDefaultApiClient();
        defaultClient.setBasePath("https://app.programmableinbox.com");
        
        // Configure HTTP bearer authorization: ApiKeyAuth
        HttpBearerAuth ApiKeyAuth = (HttpBearerAuth) defaultClient.getAuthentication("ApiKeyAuth");
        ApiKeyAuth.setBearerToken("BEARER TOKEN");

        EmailInboxesApi apiInstance = new EmailInboxesApi(defaultClient);
        String id = "id_example"; // String | The email inbox ID
        UpdateEmailInboxRequest updateEmailInboxRequest = new UpdateEmailInboxRequest(); // UpdateEmailInboxRequest | 
        try {
            ApiResponse<CreateEmailInbox201Response> response = apiInstance.updateEmailInboxWithHttpInfo(id, updateEmailInboxRequest);
            System.out.println("Status code: " + response.getStatusCode());
            System.out.println("Response headers: " + response.getHeaders());
            System.out.println("Response body: " + response.getData());
        } catch (ApiException e) {
            System.err.println("Exception when calling EmailInboxesApi#updateEmailInbox");
            System.err.println("Status code: " + e.getCode());
            System.err.println("Response headers: " + e.getResponseHeaders());
            System.err.println("Reason: " + e.getResponseBody());
            e.printStackTrace();
        }
    }
}
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **id** | **String**| The email inbox ID | |
| **updateEmailInboxRequest** | [**UpdateEmailInboxRequest**](UpdateEmailInboxRequest.md)|  | |

### Return type

ApiResponse<[**CreateEmailInbox201Response**](CreateEmailInbox201Response.md)>


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

