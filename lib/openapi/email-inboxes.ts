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
      url: 'https://api.example.com',
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
          'Returns a list of email inboxes for the organization. Requires API key with `inboxes:read` scope.',
        operationId: 'listEmailInboxes',
        tags: ['Email Inboxes'],
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          {
            name: 'organizationId',
            in: 'query',
            description:
              'Optional organization ID to filter inboxes. User must be a member of the organization, or API key must belong to this organization.',
            required: false,
            schema: { type: 'string' },
          },
        ],
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
            description:
              'Forbidden - user not member of organization or API key lacks required scope (inboxes:read)',
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
          'Returns a single email inbox by id, scoped to the organization the API key is bound to. Requires API key with `inboxes:read` scope.',
        operationId: 'getEmailInbox',
        tags: ['Email Inboxes'],
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
            description: 'API key lacks the inboxes:read scope',
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
    },
    '/api/v1/emailInbox/{id}/messages': {
      get: {
        summary: 'Get messages from an email inbox',
        description:
          'Returns messages for a specific email inbox with optional pagination and filtering. Requires API key with `messages:read` scope.',
        operationId: 'getEmailInboxMessages',
        tags: ['Email Inboxes'],
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
            example: '"order confirmed" -refund',
          },
          {
            name: 'from',
            in: 'query',
            description:
              'Case-insensitive substring match on the sender. Matches the raw header, '
              + 'so it covers both the display name and the address.',
            required: false,
            schema: { type: 'string', maxLength: 200 },
            example: 'billing@acme.com',
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
              'Forbidden - user does not own inbox, API key lacks required scope (messages:read), or API key not authorized for this organization',
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
          'Returns a specific message from an email inbox. Requires API key with `messages:read` scope.',
        operationId: 'getEmailMessage',
        tags: ['Email Inboxes'],
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
              'Forbidden - user does not own inbox, API key lacks required scope (messages:read), or API key not authorized for this organization',
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
              'One-time code parsed from the message body. Derived from text/html, which the same messages:read scope already returns.',
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
        description: 'API Key in Authorization header (Bearer token format). API keys must have appropriate scopes: inboxes:read for inbox listing, messages:read for message listing.',
      },
    },
  },
} as const
