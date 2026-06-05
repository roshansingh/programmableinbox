export const spec = {
  openapi: '3.0.0',
  info: {
    title: 'InboxUI Email Inboxes API',
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
            name: 'page',
            in: 'query',
            description: 'Page number for pagination (default: 1)',
            required: false,
            schema: { type: 'integer', minimum: 1 },
          },
          {
            name: 'limit',
            in: 'query',
            description: 'Number of messages per page (default: 50)',
            required: false,
            schema: { type: 'integer', minimum: 1 },
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
              'If true, returns only the latest message per thread (grouped view)',
            required: false,
            schema: { type: 'boolean' },
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
                          items: { $ref: '#/components/schemas/EmailMessage' },
                        },
                        total: {
                          type: 'integer',
                          description: 'Total number of messages matching the query',
                        },
                        page: {
                          type: 'integer',
                          description: 'Current page number',
                        },
                        limit: {
                          type: 'integer',
                          description: 'Messages per page',
                        },
                      },
                      required: ['messages', 'total', 'page', 'limit'],
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
        properties: {
          id: { type: 'string', example: 'inbox-1' },
          organizationId: { type: 'string', example: 'org-1' },
          userId: { type: 'string', example: 'user-1' },
          email: { type: 'string', format: 'email', example: 'support@example.com' },
          name: { type: 'string', nullable: true, example: 'Support Inbox' },
          createdAt: { type: 'string', format: 'date-time' },
        },
        required: ['id', 'organizationId', 'userId', 'email', 'createdAt'],
      },
      EmailMessage: {
        type: 'object',
        description: 'An email message',
        properties: {
          id: { type: 'string', example: 'msg-1' },
          inboxEmailAddressId: { type: 'string', example: 'inbox-1' },
          organizationId: { type: 'string', example: 'org-1' },
          from: { type: 'string', format: 'email', example: 'customer@example.com' },
          to: { type: 'string', nullable: true, example: 'support@example.com' },
          cc: { type: 'string', nullable: true },
          bcc: { type: 'string', nullable: true },
          replyTo: { type: 'string', nullable: true },
          subject: { type: 'string', example: 'Support Request' },
          body: { type: 'string', nullable: true },
          bodyPlain: { type: 'string', nullable: true },
          threadId: { type: 'string', example: 'thread-1' },
          externalId: { type: 'string' },
          messageId: { type: 'string', nullable: true },
          inReplyTo: { type: 'string', nullable: true },
          references: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
        required: ['id', 'inboxEmailAddressId', 'organizationId', 'from', 'subject', 'threadId', 'createdAt'],
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
