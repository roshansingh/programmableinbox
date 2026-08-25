# ProgrammableInbox Java SDK

Generated from `lib/openapi/email-inboxes.ts` using the `native` library option (`java.net.http`, no OkHttp/Retrofit dependency). Regenerate with `npm run sdk:generate` from the repo root — do not hand-edit anything else in this directory.

## Install

Not yet published to Maven Central. The release pipeline that publishes this now exists — see
[`sdk/README.md`](../README.md#publishing) — but publishing is gated on a maintainer bumping the
version in `pom.xml` and on Sonatype Central Portal namespace verification, tracked in
[issue #130](https://github.com/roshansingh/programmableinbox/issues/130). Until then, from a checkout:

```bash
cd sdk/java && mvn install
```

then depend on it as:

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
