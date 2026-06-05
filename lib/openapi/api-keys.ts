export const spec = {
  openapi: '3.0.0',
  info: {
    title: 'InboxUI API Keys',
    description: 'Scoped API key management endpoints',
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
      name: 'API Keys',
      description: 'API key management (JWT authentication only)',
    },
  ],
  paths: {
    '/api/v1/apiKeys': {
      get: {
        summary: 'List API keys',
        description: 'Returns a list of API keys for the authenticated user, optionally filtered by organization. Requires JWT authentication.',
        operationId: 'listApiKeys',
        tags: ['API Keys'],
        security: [{ JwtAuth: [] }],
        parameters: [
          {
            name: 'organizationId',
            in: 'query',
            description:
              'Optional organization ID to filter keys. User must be a member of the organization.',
            required: false,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Successfully retrieved API keys',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/ApiKeyListItem' },
                    },
                  },
                  required: ['data'],
                },
              },
            },
          },
          '401': {
            description: 'Unauthorized - missing or invalid token',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '403': {
            description: 'Forbidden - not a member of the requested organization',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
      post: {
        summary: 'Create an API key',
        description:
          'Creates a new API key with scopes. The raw key is returned only on creation; subsequent requests will not include it. Requires JWT authentication.',
        operationId: 'createApiKey',
        tags: ['API Keys'],
        security: [{ JwtAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateApiKeyRequest' },
            },
          },
        },
        responses: {
          '201': {
            description: 'API key created successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { $ref: '#/components/schemas/CreatedApiKey' },
                  },
                  required: ['data'],
                },
              },
            },
          },
          '400': {
            description:
              'Bad request - invalid scopes, empty name, or missing required fields',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '401': {
            description: 'Unauthorized - missing or invalid token',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '403': {
            description: 'Forbidden - not a member of the target organization',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/v1/apiKeys/{id}': {
      get: {
        summary: 'Get an API key',
        description:
          'Returns details of a specific API key. Only the owner (userId) can view their own key. Requires JWT authentication.',
        operationId: 'getApiKey',
        tags: ['API Keys'],
        security: [{ JwtAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            description: 'The API key ID',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Successfully retrieved API key',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { $ref: '#/components/schemas/ApiKeyListItem' },
                  },
                  required: ['data'],
                },
              },
            },
          },
          '401': {
            description: 'Unauthorized - missing or invalid token',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '404': {
            description: 'API key not found or not accessible',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
      delete: {
        summary: 'Delete an API key',
        description: 'Deletes a specific API key. Only the owner can delete their key. Requires JWT authentication.',
        operationId: 'deleteApiKey',
        tags: ['API Keys'],
        security: [{ JwtAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            description: 'The API key ID',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '204': {
            description: 'API key deleted successfully (no body)',
          },
          '401': {
            description: 'Unauthorized - missing or invalid token',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '404': {
            description: 'API key not found or not accessible',
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
      ApiKeyListItem: {
        type: 'object',
        description: 'An API key in list form (without the raw key)',
        properties: {
          id: { type: 'string', example: 'key-1' },
          prefix: { type: 'string', description: 'First 12 chars of the key', example: 'sk_live_prod' },
          name: { type: 'string', example: 'Production Key' },
          organizationId: { type: 'string', example: 'org-1' },
          userId: { type: 'string', example: 'user-1' },
          scopes: {
            type: 'array',
            items: { $ref: '#/components/schemas/ApiKeyScope' },
            example: ['inboxes:read', 'messages:read'],
          },
          createdAt: { type: 'string', format: 'date-time', example: '2025-01-15T10:00:00.000Z' },
        },
        required: ['id', 'prefix', 'name', 'organizationId', 'userId', 'scopes', 'createdAt'],
      },
      CreatedApiKey: {
        type: 'object',
        description: 'An API key immediately after creation (includes raw key)',
        allOf: [
          { $ref: '#/components/schemas/ApiKeyListItem' },
          {
            type: 'object',
            properties: {
              apiKey: {
                type: 'string',
                description: 'The raw API key. Only returned on creation.',
                example: 'sk_live_abcd1234efgh5678ijkl9012mnop3456qrst7890',
              },
            },
            required: ['apiKey'],
          },
        ],
      },
      CreateApiKeyRequest: {
        type: 'object',
        properties: {
          organizationId: {
            type: 'string',
            description: 'ID of the organization to create the key for',
            example: 'org-1',
          },
          name: {
            type: 'string',
            description: 'Human-readable name for the key',
            example: 'My Production Key',
          },
          scopes: {
            type: 'array',
            items: { $ref: '#/components/schemas/ApiKeyScope' },
            description: 'Permissions granted to this key (must be non-empty)',
            example: ['inboxes:read', 'messages:read'],
          },
        },
        required: ['organizationId', 'name', 'scopes'],
      },
      ApiKeyScope: {
        type: 'string',
        enum: ['inboxes:read', 'messages:read'],
        description: 'Available API key scopes',
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
      JwtAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT token in Authorization header. Required for API key management endpoints.',
      },
    },
  },
} as const
