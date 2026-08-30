# ProgrammableInbox Java SDK

[ProgrammableInbox](https://www.programmableinbox.com/) is a secondary inbox built for
developers. Spin up a programmable email address in seconds, and it receives, categorizes, and
extracts every message that arrives — grab a one-time code over the API, route mail with a rule,
or read it in the dashboard. This is a typed client for its REST API, using the `native` library
option (`java.net.http`, no OkHttp/Retrofit dependency).

## Install

```xml
<dependency>
  <groupId>com.programmableinbox</groupId>
  <artifactId>sdk</artifactId>
  <version>0.1.0</version>
</dependency>
```

## Quick start

The `native` library has no generated auth helper classes (no `HttpBearerAuth`,
no `getAuthentication`) — authenticate by attaching a request interceptor that
sets the `Authorization` header on every outgoing request:

```java
import com.programmableinbox.sdk.ApiClient;
import com.programmableinbox.sdk.api.EmailInboxesApi;
import com.programmableinbox.sdk.model.ListEmailInboxes200Response;

ApiClient client = new ApiClient();
client.setRequestInterceptor(builder -> builder.header("Authorization", "Bearer sk_live_..."));

EmailInboxesApi api = new EmailInboxesApi(client);
ListEmailInboxes200Response inboxes = api.listEmailInboxes(null);
System.out.println(inboxes.getData());
```

`listEmailInboxes` takes one nullable `String organizationId` parameter — pass
`null` to list inboxes across every organization the key can see, or an id to
scope to one.

The default base URL is `https://app.programmableinbox.com`; call `client.setBasePath("http://localhost:4000")` to point at a local dev server instead.

## Links

- [ProgrammableInbox](https://www.programmableinbox.com/)
- [API docs](https://app.programmableinbox.com/api-docs)
- [Source](https://github.com/roshansingh/programmableinbox)
