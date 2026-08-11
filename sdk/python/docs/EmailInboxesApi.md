# programmableinbox.EmailInboxesApi

All URIs are relative to *https://app.programmableinbox.com*

Method | HTTP request | Description
------------- | ------------- | -------------
[**create_email_inbox**](EmailInboxesApi.md#create_email_inbox) | **POST** /api/v1/emailInbox | Create an email inbox
[**delete_email_inbox**](EmailInboxesApi.md#delete_email_inbox) | **DELETE** /api/v1/emailInbox/{id} | Delete an email inbox
[**get_email_inbox**](EmailInboxesApi.md#get_email_inbox) | **GET** /api/v1/emailInbox/{id} | Get an email inbox
[**get_email_inbox_messages**](EmailInboxesApi.md#get_email_inbox_messages) | **GET** /api/v1/emailInbox/{id}/messages | Get messages from an email inbox
[**get_email_message**](EmailInboxesApi.md#get_email_message) | **GET** /api/v1/emailInbox/{id}/messages/{messageId} | Get a single message
[**list_email_inboxes**](EmailInboxesApi.md#list_email_inboxes) | **GET** /api/v1/emailInbox | List email inboxes
[**update_email_inbox**](EmailInboxesApi.md#update_email_inbox) | **PATCH** /api/v1/emailInbox/{id} | Rename an email inbox


# **create_email_inbox**
> CreateEmailInbox201Response create_email_inbox(create_email_inbox_request)

Create an email inbox

Claims a new email address and returns the inbox. The address must be on a domain this account can receive at, and is immutable once created. Requires API key with `email_inboxes:create` scope. The inbox is created in the organization the key is bound to; supplying a different `organizationId` is a 403 rather than a silently ignored field.

### Example

* Bearer (API Key) Authentication (ApiKeyAuth):

```python
import programmableinbox
from programmableinbox.models.create_email_inbox201_response import CreateEmailInbox201Response
from programmableinbox.models.create_email_inbox_request import CreateEmailInboxRequest
from programmableinbox.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://app.programmableinbox.com
# See configuration.py for a list of all supported configuration parameters.
configuration = programmableinbox.Configuration(
    host = "https://app.programmableinbox.com"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure Bearer authorization (API Key): ApiKeyAuth
configuration = programmableinbox.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with programmableinbox.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = programmableinbox.EmailInboxesApi(api_client)
    create_email_inbox_request = programmableinbox.CreateEmailInboxRequest() # CreateEmailInboxRequest | 

    try:
        # Create an email inbox
        api_response = api_instance.create_email_inbox(create_email_inbox_request)
        print("The response of EmailInboxesApi->create_email_inbox:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling EmailInboxesApi->create_email_inbox: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **create_email_inbox_request** | [**CreateEmailInboxRequest**](CreateEmailInboxRequest.md)|  | 

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
**201** | Inbox created |  -  |
**400** | Bad request - malformed JSON, the address is not a valid email address, the domain is not one this account may create inboxes at, the local part is longer than 50 characters, or the name is not a string or is longer than 100 characters. |  -  |
**401** | Unauthorized - missing or invalid API key |  -  |
**403** | Forbidden - API key lacks the email_inboxes:create scope, or the body names a different organization |  -  |
**409** | Conflict - the address is not available. Returned identically whether it is held by another organization or by a deleted inbox, so this endpoint cannot be used to probe which addresses exist. |  -  |
**422** | Unprocessable - the address or the name is on the impersonation blocklist, or the name contains characters outside printable ASCII. A disallowed domain is a 400, not this. |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **delete_email_inbox**
> delete_email_inbox(id)

Delete an email inbox

Soft-deletes the inbox and its messages in one transaction. The rows are retained and every read filters them out, so the data is recoverable — but the **address is retired permanently and can never be claimed again, by anyone including you**. Mail keeps being delivered to it, so releasing it would hand the next claimant your still-arriving messages. Requires API key with `email_inboxes:delete` scope, which is granted separately from create and update for exactly this reason.

### Example

* Bearer (API Key) Authentication (ApiKeyAuth):

```python
import programmableinbox
from programmableinbox.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://app.programmableinbox.com
# See configuration.py for a list of all supported configuration parameters.
configuration = programmableinbox.Configuration(
    host = "https://app.programmableinbox.com"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure Bearer authorization (API Key): ApiKeyAuth
configuration = programmableinbox.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with programmableinbox.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = programmableinbox.EmailInboxesApi(api_client)
    id = 'id_example' # str | The email inbox ID

    try:
        # Delete an email inbox
        api_instance.delete_email_inbox(id)
    except Exception as e:
        print("Exception when calling EmailInboxesApi->delete_email_inbox: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **str**| The email inbox ID | 

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
**204** | Inbox deleted. No body — the record is no longer readable. |  -  |
**401** | Unauthorized - missing or invalid API key |  -  |
**403** | Forbidden - API key lacks the email_inboxes:delete scope. Holding create and update does not grant it. |  -  |
**404** | Not found - no such inbox, or it is not one this key may delete. Deliberately indistinguishable. |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_email_inbox**
> GetEmailInbox200Response get_email_inbox(id)

Get an email inbox

Returns a single email inbox by id, scoped to the organization the API key is bound to. Requires API key with `email_inboxes:read` scope.

### Example

* Bearer (API Key) Authentication (ApiKeyAuth):

```python
import programmableinbox
from programmableinbox.models.get_email_inbox200_response import GetEmailInbox200Response
from programmableinbox.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://app.programmableinbox.com
# See configuration.py for a list of all supported configuration parameters.
configuration = programmableinbox.Configuration(
    host = "https://app.programmableinbox.com"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure Bearer authorization (API Key): ApiKeyAuth
configuration = programmableinbox.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with programmableinbox.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = programmableinbox.EmailInboxesApi(api_client)
    id = 'id_example' # str | Email inbox ID

    try:
        # Get an email inbox
        api_response = api_instance.get_email_inbox(id)
        print("The response of EmailInboxesApi->get_email_inbox:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling EmailInboxesApi->get_email_inbox: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **str**| Email inbox ID | 

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
**200** | The email inbox |  -  |
**401** | Missing, malformed or revoked API key |  -  |
**403** | API key lacks the email_inboxes:read scope |  -  |
**404** | No such inbox in the organization the key is bound to. Deliberately indistinguishable from an inbox that does not exist. |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_email_inbox_messages**
> GetEmailInboxMessages200Response get_email_inbox_messages(id, cursor=cursor, limit=limit, thread_id=thread_id, grouped=grouped, q=q, var_from=var_from, tags=tags, categories=categories)

Get messages from an email inbox

Returns messages for a specific email inbox with optional pagination and filtering. Requires API key with `email_messages:read` scope.

### Example

* Bearer (API Key) Authentication (ApiKeyAuth):

```python
import programmableinbox
from programmableinbox.models.get_email_inbox_messages200_response import GetEmailInboxMessages200Response
from programmableinbox.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://app.programmableinbox.com
# See configuration.py for a list of all supported configuration parameters.
configuration = programmableinbox.Configuration(
    host = "https://app.programmableinbox.com"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure Bearer authorization (API Key): ApiKeyAuth
configuration = programmableinbox.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with programmableinbox.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = programmableinbox.EmailInboxesApi(api_client)
    id = 'id_example' # str | The email inbox ID
    cursor = 'cursor_example' # str | Opaque pagination cursor from a previous response's nextCursor. Omit for the first page. (optional)
    limit = 56 # int | Number of messages per page (default: 50, max: 100) (optional)
    thread_id = 'thread_id_example' # str | Optional thread ID to filter messages to a specific thread (optional)
    grouped = True # bool | If true, returns only the latest message per thread (grouped view). Cannot be combined with any search parameter — the combination returns 400. (optional)
    q = '\"order confirmed\" -refund' # str | Full-text search over the subject and the message body. Supports \"quoted phrases\", `or`, and `-negation` (Postgres websearch syntax). The body searched is the plain-text `bodyText` field, which is extracted from `html` for messages that carry no text part. Results stay in reverse-chronological order — this filters, it does not rank. (optional)
    var_from = 'billing@acme.com' # str | Case-insensitive substring match on the sender. Matches the raw header, so it covers both the display name and the address. (optional)
    tags = ['tags_example'] # List[str] | Return messages carrying any of these tags (exact match, OR-combined). Repeat the parameter: tags=a&tags=b. A comma-separated single value (tags=a,b) is also accepted, but cannot express a tag that itself contains a comma. Max 20 values. (optional)
    categories = ['categories_example'] # List[str] | Return messages carrying any of these categories (exact match, OR-combined). Repeat the parameter: categories=a&categories=b. A comma-separated single value is also accepted, but cannot express a category that itself contains a comma. Max 20 values. (optional)

    try:
        # Get messages from an email inbox
        api_response = api_instance.get_email_inbox_messages(id, cursor=cursor, limit=limit, thread_id=thread_id, grouped=grouped, q=q, var_from=var_from, tags=tags, categories=categories)
        print("The response of EmailInboxesApi->get_email_inbox_messages:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling EmailInboxesApi->get_email_inbox_messages: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **str**| The email inbox ID | 
 **cursor** | **str**| Opaque pagination cursor from a previous response&#39;s nextCursor. Omit for the first page. | [optional] 
 **limit** | **int**| Number of messages per page (default: 50, max: 100) | [optional] 
 **thread_id** | **str**| Optional thread ID to filter messages to a specific thread | [optional] 
 **grouped** | **bool**| If true, returns only the latest message per thread (grouped view). Cannot be combined with any search parameter — the combination returns 400. | [optional] 
 **q** | **str**| Full-text search over the subject and the message body. Supports \&quot;quoted phrases\&quot;, &#x60;or&#x60;, and &#x60;-negation&#x60; (Postgres websearch syntax). The body searched is the plain-text &#x60;bodyText&#x60; field, which is extracted from &#x60;html&#x60; for messages that carry no text part. Results stay in reverse-chronological order — this filters, it does not rank. | [optional] 
 **var_from** | **str**| Case-insensitive substring match on the sender. Matches the raw header, so it covers both the display name and the address. | [optional] 
 **tags** | [**List[str]**](str.md)| Return messages carrying any of these tags (exact match, OR-combined). Repeat the parameter: tags&#x3D;a&amp;tags&#x3D;b. A comma-separated single value (tags&#x3D;a,b) is also accepted, but cannot express a tag that itself contains a comma. Max 20 values. | [optional] 
 **categories** | [**List[str]**](str.md)| Return messages carrying any of these categories (exact match, OR-combined). Repeat the parameter: categories&#x3D;a&amp;categories&#x3D;b. A comma-separated single value is also accepted, but cannot express a category that itself contains a comma. Max 20 values. | [optional] 

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
**200** | Successfully retrieved messages |  -  |
**400** | Invalid cursor, a search parameter over its length or value limit, or a search parameter combined with grouped&#x3D;true |  -  |
**401** | Unauthorized - missing or invalid token/API key |  -  |
**403** | Forbidden - user does not own inbox, API key lacks required scope (email_messages:read), or API key not authorized for this organization |  -  |
**404** | Email inbox not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_email_message**
> GetEmailMessage200Response get_email_message(id, message_id)

Get a single message

Returns a specific message from an email inbox. Requires API key with `email_messages:read` scope.

### Example

* Bearer (API Key) Authentication (ApiKeyAuth):

```python
import programmableinbox
from programmableinbox.models.get_email_message200_response import GetEmailMessage200Response
from programmableinbox.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://app.programmableinbox.com
# See configuration.py for a list of all supported configuration parameters.
configuration = programmableinbox.Configuration(
    host = "https://app.programmableinbox.com"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure Bearer authorization (API Key): ApiKeyAuth
configuration = programmableinbox.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with programmableinbox.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = programmableinbox.EmailInboxesApi(api_client)
    id = 'id_example' # str | The email inbox ID
    message_id = 'message_id_example' # str | The message ID

    try:
        # Get a single message
        api_response = api_instance.get_email_message(id, message_id)
        print("The response of EmailInboxesApi->get_email_message:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling EmailInboxesApi->get_email_message: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **str**| The email inbox ID | 
 **message_id** | **str**| The message ID | 

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
**200** | Successfully retrieved message |  -  |
**401** | Unauthorized - missing or invalid API key |  -  |
**403** | Forbidden - user does not own inbox, API key lacks required scope (email_messages:read), or API key not authorized for this organization |  -  |
**404** | Message or inbox not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **list_email_inboxes**
> ListEmailInboxes200Response list_email_inboxes(organization_id=organization_id)

List email inboxes

Returns a list of email inboxes for the organization. Requires API key with `email_inboxes:read` scope.

### Example

* Bearer (API Key) Authentication (ApiKeyAuth):

```python
import programmableinbox
from programmableinbox.models.list_email_inboxes200_response import ListEmailInboxes200Response
from programmableinbox.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://app.programmableinbox.com
# See configuration.py for a list of all supported configuration parameters.
configuration = programmableinbox.Configuration(
    host = "https://app.programmableinbox.com"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure Bearer authorization (API Key): ApiKeyAuth
configuration = programmableinbox.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with programmableinbox.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = programmableinbox.EmailInboxesApi(api_client)
    organization_id = 'organization_id_example' # str | Optional organization ID to filter inboxes. User must be a member of the organization, or API key must belong to this organization. (optional)

    try:
        # List email inboxes
        api_response = api_instance.list_email_inboxes(organization_id=organization_id)
        print("The response of EmailInboxesApi->list_email_inboxes:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling EmailInboxesApi->list_email_inboxes: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **organization_id** | **str**| Optional organization ID to filter inboxes. User must be a member of the organization, or API key must belong to this organization. | [optional] 

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
**200** | Successfully retrieved email inboxes |  -  |
**401** | Unauthorized - missing or invalid token/API key |  -  |
**403** | Forbidden - user not member of organization or API key lacks required scope (email_inboxes:read) |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **update_email_inbox**
> CreateEmailInbox201Response update_email_inbox(id, update_email_inbox_request)

Rename an email inbox

Updates an inbox display name. The address is immutable — submitting a different one is a 409; submitting the current one (after normalization) is an allowed no-op, so a client can PATCH a whole record back. Requires API key with `email_inboxes:update` scope.

### Example

* Bearer (API Key) Authentication (ApiKeyAuth):

```python
import programmableinbox
from programmableinbox.models.create_email_inbox201_response import CreateEmailInbox201Response
from programmableinbox.models.update_email_inbox_request import UpdateEmailInboxRequest
from programmableinbox.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://app.programmableinbox.com
# See configuration.py for a list of all supported configuration parameters.
configuration = programmableinbox.Configuration(
    host = "https://app.programmableinbox.com"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure Bearer authorization (API Key): ApiKeyAuth
configuration = programmableinbox.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with programmableinbox.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = programmableinbox.EmailInboxesApi(api_client)
    id = 'id_example' # str | The email inbox ID
    update_email_inbox_request = programmableinbox.UpdateEmailInboxRequest() # UpdateEmailInboxRequest | 

    try:
        # Rename an email inbox
        api_response = api_instance.update_email_inbox(id, update_email_inbox_request)
        print("The response of EmailInboxesApi->update_email_inbox:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling EmailInboxesApi->update_email_inbox: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **str**| The email inbox ID | 
 **update_email_inbox_request** | [**UpdateEmailInboxRequest**](UpdateEmailInboxRequest.md)|  | 

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
**200** | Inbox updated |  -  |
**400** | Bad request - malformed JSON, the name is not a string or is longer than 100 characters, or &#x60;email&#x60; was supplied and is not a valid email address. A well-formed address that differs from the current one is a 409 instead. |  -  |
**401** | Unauthorized - missing or invalid API key |  -  |
**403** | Forbidden - API key lacks the email_inboxes:update scope |  -  |
**404** | Not found - no such inbox, or it is not one this key may modify. Deliberately indistinguishable. |  -  |
**409** | Conflict - the address of an inbox cannot be changed |  -  |
**422** | Unprocessable - the name is on the impersonation blocklist, or it contains characters outside printable ASCII. Both are the same rule: a Cyrillic lookalike normalizes past the blocklist and only the charset guard stops it. |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

