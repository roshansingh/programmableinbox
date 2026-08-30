export const spec = {
  openapi: '3.0.0',
  info: {
    title: 'ProgrammableInbox Email Inboxes API',
    description: 'Email inbox management endpoints with API key support',
    version: '1.0.0',
  },
  servers: [
    {
      url: 'http://localhost:4000',
      description: 'Local development',
    },
    {
      url: 'https://app.programmableinbox.com',
      description: 'Production',
    },
  ],
  tags: [
    {
      name: 'Email Inboxes',
      description: 'Email inbox management (JWT or API key authentication)',
    },
  ],
  paths: {
    '/api/v1/emailInbox': {
      get: {
        summary: 'List email inboxes',
        description:
          'Returns a list of email inboxes for the organization. Requires API key with `email_inboxes:read` scope.',
        operationId: 'listEmailInboxes',
        tags: ['Email Inboxes'],
        'x-codeSamples': [
          {
            lang: 'Python',
            label: 'Python',
            source: `import programmableinbox
from programmableinbox.api.email_inboxes_api import EmailInboxesApi

configuration = programmableinbox.Configuration(access_token="sk_live_...")
with programmableinbox.ApiClient(configuration) as api_client:
    api = EmailInboxesApi(api_client)
    inboxes = api.list_email_inboxes()
    print(inboxes.data)`,
          },
          {
            lang: 'Go',
            label: 'Go',
            source: `configuration := programmableinbox.NewConfiguration()
client := programmableinbox.NewAPIClient(configuration)
ctx := context.WithValue(context.Background(), programmableinbox.ContextAccessToken, "sk_live_...")

inboxes, _, err := client.EmailInboxesAPI.ListEmailInboxes(ctx).Execute()`,
          },
          {
            lang: 'NodeJs',
            label: 'Node.js',
            source: `import { Configuration, EmailInboxesApi } from '@programmableinbox/sdk'

const config = new Configuration({ accessToken: 'sk_live_...' })
const api = new EmailInboxesApi(config)

const inboxes = await api.listEmailInboxes()`,
          },
          {
            lang: 'C#',
            label: 'C#',
            source: `var host = Host.CreateDefaultBuilder(args)
    .ConfigureApi((context, options) => { options.AddTokens(new BearerToken("sk_live_...")); })
    .Build();
var api = host.Services.GetRequiredService<IEmailInboxesApi>();

var response = await api.ListEmailInboxesAsync();
var inboxes = response.Ok();`,
          },
        ],
        security: [{ ApiKeyAuth: [] }],
        responses: {
          '200': {
            description: 'Successfully retrieved email inboxes',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/EmailInbox' },
                    },
                  },
                  required: ['data'],
                },
              },
            },
          },
          '401': {
            description: 'Unauthorized - missing or invalid token/API key',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '403': {
            description: 'Forbidden - API key lacks required scope (email_inboxes:read)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
      post: {
        summary: 'Create an email inbox',
        description:
          'Claims a new email address and returns the inbox. The address must be on a domain this account can receive at, and is immutable once created. Requires API key with `email_inboxes:create` scope. The inbox is always created in the organization the key is bound to — there is no way to name a different one.',
        operationId: 'createEmailInbox',
        tags: ['Email Inboxes'],
        'x-codeSamples': [
          {
            lang: 'Python',
            label: 'Python',
            source: `from programmableinbox.models.create_email_inbox_request import CreateEmailInboxRequest

req = CreateEmailInboxRequest(email="orders@example.com", name="Orders")
inbox = api.create_email_inbox(req)`,
          },
          {
            lang: 'Go',
            label: 'Go',
            source: `req := programmableinbox.NewCreateEmailInboxRequest("orders@example.com")
req.SetName("Orders")

inbox, _, err := client.EmailInboxesAPI.CreateEmailInbox(ctx).CreateEmailInboxRequest(*req).Execute()`,
          },
          {
            lang: 'NodeJs',
            label: 'Node.js',
            source: `const inbox = await api.createEmailInbox({
  createEmailInboxRequest: { email: 'orders@example.com', name: 'Orders' },
})`,
          },
          {
            lang: 'C#',
            label: 'C#',
            source: `var req = new CreateEmailInboxRequest("orders@example.com", name: "Orders");
var response = await api.CreateEmailInboxAsync(req);
var inbox = response.Created();`,
          },
        ],
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: {
                    type: 'string',
                    format: 'email',
                    description:
                      'The address to claim. Normalized to lowercase before storage, and permanent once created.',
                  },
                  name: {
                    type: 'string',
                    nullable: true,
                    description:
                      'Optional display label. Subject to the same impersonation blocklist as the address.',
                  },
                },
                required: ['email'],
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Inbox created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { data: { $ref: '#/components/schemas/EmailInbox' } },
                  required: ['data'],
                },
              },
            },
          },
          '400': {
            description:
              'Bad request - malformed JSON, the address is not a valid email address, '
              + 'the domain is not one this account may create inboxes at, the local part '
              + 'is longer than 50 characters, or the name is not a string or is longer '
              + 'than 100 characters.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '401': {
            description: 'Unauthorized - missing or invalid API key',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '403': {
            description: 'Forbidden - API key lacks the email_inboxes:create scope',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '409': {
            description:
              'Conflict - the address is not available. Returned identically whether it is held by another organization or by a deleted inbox, so this endpoint cannot be used to probe which addresses exist.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '422': {
            description:
              'Unprocessable - the address or the name is on the impersonation blocklist, '
              + 'or the name contains characters outside printable ASCII. A disallowed '
              + 'domain is a 400, not this.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/v1/emailInbox/{id}': {
      get: {
        summary: 'Get an email inbox',
        description:
          'Returns a single email inbox by id, scoped to the organization the API key is bound to. Requires API key with `email_inboxes:read` scope.',
        operationId: 'getEmailInbox',
        tags: ['Email Inboxes'],
        'x-codeSamples': [
          {
            lang: 'Python',
            label: 'Python',
            source: `inbox = api.get_email_inbox(id="inbx_123")`,
          },
          {
            lang: 'Go',
            label: 'Go',
            source: `inbox, _, err := client.EmailInboxesAPI.GetEmailInbox(ctx, "inbx_123").Execute()`,
          },
          {
            lang: 'NodeJs',
            label: 'Node.js',
            source: `const inbox = await api.getEmailInbox({ id: 'inbx_123' })`,
          },
          {
            lang: 'C#',
            label: 'C#',
            source: `var response = await api.GetEmailInboxAsync("inbx_123");
var inbox = response.Ok();`,
          },
        ],
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Email inbox ID',
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'The email inbox',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { data: { $ref: '#/components/schemas/EmailInbox' } },
                },
              },
            },
          },
          401: {
            description: 'Missing, malformed or revoked API key',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          403: {
            description: 'API key lacks the email_inboxes:read scope',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          404: {
            description:
              'No such inbox in the organization the key is bound to. Deliberately indistinguishable from an inbox that does not exist.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
      patch: {
        summary: 'Rename an email inbox',
        description:
          'Updates an inbox display name. The address is immutable and is not part of this '
          + 'request. Requires API key with `email_inboxes:update` scope.',
        operationId: 'updateEmailInbox',
        tags: ['Email Inboxes'],
        'x-codeSamples': [
          {
            lang: 'Python',
            label: 'Python',
            source: `from programmableinbox.models.update_email_inbox_request import UpdateEmailInboxRequest

inbox = api.update_email_inbox(
    id="inbx_123",
    update_email_inbox_request=UpdateEmailInboxRequest(name="New Name"),
)`,
          },
          {
            lang: 'Go',
            label: 'Go',
            source: `req := programmableinbox.NewUpdateEmailInboxRequest()
req.SetName("New Name")

inbox, _, err := client.EmailInboxesAPI.UpdateEmailInbox(ctx, "inbx_123").UpdateEmailInboxRequest(*req).Execute()`,
          },
          {
            lang: 'NodeJs',
            label: 'Node.js',
            source: `const inbox = await api.updateEmailInbox({
  id: 'inbx_123',
  updateEmailInboxRequest: { name: 'New Name' },
})`,
          },
          {
            lang: 'C#',
            label: 'C#',
            source: `var req = new UpdateEmailInboxRequest(name: "New Name");
var response = await api.UpdateEmailInboxAsync("inbx_123", req);
var inbox = response.Ok();`,
          },
        ],
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            description: 'The email inbox ID',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    nullable: true,
                    description:
                      'The new display label. Subject to the impersonation blocklist, so an inbox cannot be renamed into one.',
                  },
                },
              },
              example: { name: 'Support Inbox' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Inbox updated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { data: { $ref: '#/components/schemas/EmailInbox' } },
                  required: ['data'],
                },
              },
            },
          },
          '400': {
            description:
              'Bad request - malformed JSON, or the name is not a string or is longer than '
              + '100 characters.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '401': {
            description: 'Unauthorized - missing or invalid API key',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '403': {
            description: 'Forbidden - API key lacks the email_inboxes:update scope',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '404': {
            description:
              'Not found - no such inbox, or it is not one this key may modify. Deliberately indistinguishable.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '409': {
            description: 'Conflict - the address of an inbox cannot be changed',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '422': {
            description:
              'Unprocessable - the name is on the impersonation blocklist, or it contains '
              + 'characters outside printable ASCII. Both are the same rule: a Cyrillic '
              + 'lookalike normalizes past the blocklist and only the charset guard stops it.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
      delete: {
        summary: 'Delete an email inbox',
        description:
          'Soft-deletes the inbox and its messages in one transaction. The rows are retained and every read filters them out, so the data is recoverable — but the **address is retired permanently and can never be claimed again, by anyone including you**. Mail keeps being delivered to it, so releasing it would hand the next claimant your still-arriving messages. Requires API key with `email_inboxes:delete` scope, which is granted separately from create and update for exactly this reason.',
        operationId: 'deleteEmailInbox',
        tags: ['Email Inboxes'],
        'x-codeSamples': [
          {
            lang: 'Python',
            label: 'Python',
            source: `api.delete_email_inbox(id="inbx_123")`,
          },
          {
            lang: 'Go',
            label: 'Go',
            source: `_, err := client.EmailInboxesAPI.DeleteEmailInbox(ctx, "inbx_123").Execute()`,
          },
          {
            lang: 'NodeJs',
            label: 'Node.js',
            source: `await api.deleteEmailInbox({ id: 'inbx_123' })`,
          },
          {
            lang: 'C#',
            label: 'C#',
            source: `var response = await api.DeleteEmailInboxAsync("inbx_123");`,
          },
        ],
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            description: 'The email inbox ID',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '204': {
            description: 'Inbox deleted. No body — the record is no longer readable.',
          },
          '401': {
            description: 'Unauthorized - missing or invalid API key',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '403': {
            description:
              'Forbidden - API key lacks the email_inboxes:delete scope. Holding create and update does not grant it.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '404': {
            description:
              'Not found - no such inbox, or it is not one this key may delete. Deliberately indistinguishable.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/v1/emailInbox/{id}/messages': {
      get: {
        summary: 'Get messages from an email inbox',
        description:
          'Returns messages for a specific email inbox with optional pagination and filtering. Requires API key with `email_messages:read` scope.',
        operationId: 'getEmailInboxMessages',
        tags: ['Email Inboxes'],
        'x-codeSamples': [
          {
            lang: 'Python',
            label: 'Python',
            source: `page = api.get_email_inbox_messages(
    id="inbx_123",
    limit=25,
    q="invoice",
    var_from="stripe.com",
    tags=["billing"],
)`,
          },
          {
            lang: 'Go',
            label: 'Go',
            source: `page, _, err := client.EmailInboxesAPI.GetEmailInboxMessages(ctx, "inbx_123").
    Limit(25).
    Q("invoice").
    From("stripe.com").
    Tags([]string{"billing"}).
    Execute()`,
          },
          {
            lang: 'NodeJs',
            label: 'Node.js',
            source: `const page = await api.getEmailInboxMessages({
  id: 'inbx_123',
  limit: 25,
  q: 'invoice',
  from: 'stripe.com',
  tags: ['billing'],
})`,
          },
          {
            lang: 'C#',
            label: 'C#',
            source: `var response = await api.GetEmailInboxMessagesAsync(
    "inbx_123",
    limit: new Option<int>(25),
    q: new Option<string>("invoice"),
    from: new Option<string>("stripe.com"),
    tags: new Option<List<string>>(new List<string> { "billing" }));
var page = response.Ok();`,
          },
        ],
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            description: 'The email inbox ID',
            required: true,
            schema: { type: 'string' },
          },
          {
            name: 'cursor',
            in: 'query',
            description: 'Opaque pagination cursor from a previous response\'s nextCursor. Omit for the first page.',
            required: false,
            schema: { type: 'string' },
          },
          {
            name: 'limit',
            in: 'query',
            description: 'Number of messages per page (default: 50, max: 100)',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 100 },
          },
          {
            name: 'threadId',
            in: 'query',
            description: 'Optional thread ID to filter messages to a specific thread',
            required: false,
            schema: { type: 'string' },
          },
          {
            name: 'grouped',
            in: 'query',
            description:
              'If true, returns only the latest message per thread (grouped view). '
              + 'Cannot be combined with any search parameter — the combination returns 400.',
            required: false,
            schema: { type: 'boolean' },
          },
          {
            name: 'q',
            in: 'query',
            description:
              'Full-text search over the subject and the message body. Supports '
              + '"quoted phrases", `or`, and `-negation` (Postgres websearch syntax). '
              + 'The body searched is the plain-text `bodyText` field, which is extracted '
              + 'from `html` for messages that carry no text part. Results stay in '
              + 'reverse-chronological order — this filters, it does not rank.',
            required: false,
            schema: { type: 'string', maxLength: 200 },
          },
          {
            name: 'from',
            in: 'query',
            description:
              'Case-insensitive substring match on the sender. Matches the raw header, '
              + 'so it covers both the display name and the address.',
            required: false,
            schema: { type: 'string', maxLength: 200 },
          },
          {
            name: 'tags',
            in: 'query',
            description:
              'Return messages carrying any of these tags (exact match, OR-combined). '
              + 'Repeat the parameter: tags=a&tags=b. A comma-separated single value '
              + '(tags=a,b) is also accepted, but cannot express a tag that itself '
              + 'contains a comma. Max 20 values.',
            required: false,
            schema: { type: 'array', items: { type: 'string' }, maxItems: 20 },
            // explode:true — the repeated form is the documented contract because it
            // round-trips any value. The server also accepts the comma-separated form,
            // which is a deliberate superset, not what this describes.
            style: 'form',
            explode: true,
          },
          {
            name: 'categories',
            in: 'query',
            description:
              'Return messages carrying any of these categories (exact match, '
              + 'OR-combined). Repeat the parameter: categories=a&categories=b. A '
              + 'comma-separated single value is also accepted, but cannot express a '
              + 'category that itself contains a comma. Max 20 values.',
            required: false,
            schema: { type: 'array', items: { type: 'string' }, maxItems: 20 },
            // See the note on `tags` above.
            style: 'form',
            explode: true,
          },
        ],
        responses: {
          '200': {
            description: 'Successfully retrieved messages',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'object',
                      properties: {
                        messages: {
                          type: 'array',
                          items: {
                            allOf: [
                              { $ref: '#/components/schemas/EmailMessage' },
                              {
                                type: 'object',
                                properties: {
                                  threadCount: {
                                    type: 'integer',
                                    description: 'Number of messages in the thread (present only in grouped mode)',
                                  },
                                },
                              },
                            ],
                          },
                        },
                        nextCursor: {
                          type: 'string',
                          nullable: true,
                          description: 'Cursor for the next page, or null if there are no more results',
                        },
                        hasMore: {
                          type: 'boolean',
                          description: 'True if more results exist beyond this page',
                        },
                      },
                      required: ['messages', 'nextCursor', 'hasMore'],
                    },
                  },
                  required: ['data'],
                },
              },
            },
          },
          '400': {
            description:
              'Invalid cursor, a search parameter over its length or value limit, or a '
              + 'search parameter combined with grouped=true',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '401': {
            description: 'Unauthorized - missing or invalid token/API key',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '403': {
            description:
              'Forbidden - user does not own inbox, API key lacks required scope (email_messages:read), or API key not authorized for this organization',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '404': {
            description: 'Email inbox not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/v1/emailInbox/{id}/messages/{messageId}': {
      get: {
        summary: 'Get a single message',
        description:
          'Returns a specific message from an email inbox. Requires API key with `email_messages:read` scope.',
        operationId: 'getEmailMessage',
        tags: ['Email Inboxes'],
        'x-codeSamples': [
          {
            lang: 'Python',
            label: 'Python',
            source: `msg = api.get_email_message(id="inbx_123", message_id="msg_456")`,
          },
          {
            lang: 'Go',
            label: 'Go',
            source: `msg, _, err := client.EmailInboxesAPI.GetEmailMessage(ctx, "inbx_123", "msg_456").Execute()`,
          },
          {
            lang: 'NodeJs',
            label: 'Node.js',
            source: `const msg = await api.getEmailMessage({ id: 'inbx_123', messageId: 'msg_456' })`,
          },
          {
            lang: 'C#',
            label: 'C#',
            source: `var response = await api.GetEmailMessageAsync("inbx_123", "msg_456");
var msg = response.Ok();`,
          },
        ],
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            description: 'The email inbox ID',
            required: true,
            schema: { type: 'string' },
          },
          {
            name: 'messageId',
            in: 'path',
            description: 'The message ID',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Successfully retrieved message',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { $ref: '#/components/schemas/EmailMessage' },
                  },
                  required: ['data'],
                },
              },
            },
          },
          '401': {
            description: 'Unauthorized - missing or invalid API key',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '403': {
            description:
              'Forbidden - user does not own inbox, API key lacks required scope (email_messages:read), or API key not authorized for this organization',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '404': {
            description: 'Message or inbox not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/v1/emailInbox/{id}/otp': {
      get: {
        summary: 'Get the latest one-time code for an inbox',
        description:
          'Returns the most recently extracted one-time passcode (OTP) for an email inbox, '
          + 'with the message it came from. Requires API key with `email_messages:read` scope — '
          + 'this is a read of extracted message content, not inbox metadata. Shares its lookup '
          + 'and arguments with the pibx_email_get_latest_otp MCP tool.',
        operationId: 'getEmailInboxOtp',
        tags: ['Email Inboxes'],
        'x-codeSamples': [
          {
            lang: 'Python',
            label: 'Python',
            source: `otp = api.get_email_inbox_otp(id="inbx_123", var_from="stripe.com", within_minutes=10)`,
          },
          {
            lang: 'Go',
            label: 'Go',
            source: `otp, _, err := client.EmailInboxesAPI.GetEmailInboxOtp(ctx, "inbx_123").From("stripe.com").WithinMinutes(10).Execute()`,
          },
          {
            lang: 'NodeJs',
            label: 'Node.js',
            source: `const otp = await api.getEmailInboxOtp({ id: 'inbx_123', from: 'stripe.com', withinMinutes: 10 })`,
          },
          {
            lang: 'C#',
            label: 'C#',
            source: `var response = await api.GetEmailInboxOtpAsync(
    "inbx_123", from: new Option<string>("stripe.com"), withinMinutes: new Option<int>(10));
var otp = response.Ok();`,
          },
        ],
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            description: 'The email inbox ID',
            required: true,
            schema: { type: 'string' },
          },
          {
            name: 'from',
            in: 'query',
            description:
              'Only consider messages whose From header contains this substring, e.g. '
              + '"stripe.com". Case-insensitive, matches the raw header.',
            required: false,
            schema: { type: 'string', maxLength: 200 },
          },
          {
            name: 'withinMinutes',
            in: 'query',
            description:
              'How recent the code must be. Defaults to 15 minutes, because a stale code '
              + 'looks identical to a fresh one and will silently fail wherever it is used.',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 1440, default: 15 },
          },
        ],
        responses: {
          '200': {
            description: 'Successfully retrieved the latest OTP',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'object',
                      properties: {
                        otp: { type: 'string', example: '123456' },
                        message: { $ref: '#/components/schemas/EmailMessage' },
                      },
                      required: ['otp', 'message'],
                    },
                  },
                  required: ['data'],
                },
              },
            },
          },
          '400': {
            description: 'Bad request - withinMinutes out of range, or from over the length cap',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '401': {
            description: 'Unauthorized - missing or invalid API key',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '403': {
            description: 'Forbidden - API key lacks required scope (email_messages:read)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '404': {
            description:
              'Not found - no such inbox visible to this key, or no message with an '
              + 'extracted OTP has arrived within withinMinutes. The message distinguishes '
              + 'a stale code (one exists but is older than the window) from none at all.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      EmailInbox: {
        type: 'object',
        description: 'An email inbox',
        // Mirrors serializePublicInbox in lib/serializers/public/email-inbox.ts.
        // userId is deliberately absent — it identifies another member of the
        // organization and the external contract does not expose it.
        properties: {
          id: { type: 'string', example: 'inbox-1' },
          organizationId: { type: 'string', example: 'org-1' },
          email: { type: 'string', format: 'email', example: 'support@example.com' },
          name: { type: 'string', nullable: true, example: 'Support Inbox' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
        required: ['id', 'organizationId', 'email', 'name', 'createdAt', 'updatedAt'],
      },
      EmailMessage: {
        type: 'object',
        description: 'An email message',
        // Mirrors serializePublicMessage in lib/serializers/public/email-inbox.ts.
        // Provider and threading internals (externalId, headers, messageId,
        // inReplyTo, references) and worker state (categories, metadata,
        // enrichedAt) are not part of the external contract.
        properties: {
          id: { type: 'string', example: 'msg-1' },
          threadId: { type: 'string', example: 'thread-1' },
          parentMessageId: { type: 'string', nullable: true, example: 'msg-0' },
          subject: { type: 'string', example: 'Support Request' },
          from: { type: 'string', format: 'email', example: 'customer@example.com' },
          to: { type: 'array', items: { type: 'string', format: 'email' } },
          cc: { type: 'array', items: { type: 'string', format: 'email' } },
          bcc: { type: 'array', items: { type: 'string', format: 'email' } },
          text: { type: 'string', example: 'Hello, I need help with...' },
          html: { type: 'string', example: '<p>Hello, I need help with...</p>' },
          bodyText: {
            type: 'string',
            nullable: true,
            example: 'Hello, I need help with...',
            description:
              'Plain text of the body, and the field the `q` parameter searches. Equal '
              + 'to `text` when the sender supplied a text part, otherwise extracted from '
              + '`html`. Null for messages stored before this field existed.',
          },
          isStarred: { type: 'boolean', example: false },
          isRead: {
            type: 'boolean',
            example: false,
            description:
              'Inbox-wide, not per-user: one shared flag reflecting whether any '
              + 'viewer has opened this message.',
          },
          tags: { type: 'array', items: { type: 'string' } },
          categories: {
            type: 'array',
            items: { type: 'string' },
            description: 'Categories assigned to the message. Matched by the `categories` parameter.',
          },
          extractedOtp: {
            type: 'string',
            nullable: true,
            example: '123456',
            description:
              'One-time code parsed from the message body. Derived from text/html, which the same email_messages:read scope already returns.',
          },
          createdAt: { type: 'string', format: 'date-time' },
          threadCount: {
            type: 'integer',
            description: 'Number of messages in the thread (present only in grouped mode)',
          },
        },
        required: [
          'id',
          'threadId',
          'parentMessageId',
          'subject',
          'from',
          'to',
          'cc',
          'bcc',
          'text',
          'html',
          'bodyText',
          'isStarred',
          'isRead',
          'tags',
          'categories',
          'extractedOtp',
          'createdAt',
        ],
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'Error message',
            example: 'Unauthorized',
          },
        },
        required: ['message'],
      },
    },
    securitySchemes: {
      ApiKeyAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'API Key',
        description: 'API Key in Authorization header (Bearer token format). API keys must have appropriate scopes: email_inboxes:read for inbox listing, email_messages:read for message listing.',
      },
    },
  },
} as const
