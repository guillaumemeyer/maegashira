// @ts-ignore
import pck from '../../package.json'

/**
 * @function getOpenApiExplorer
 * @description Get the OpenAPI Explorer
 * @param {string} baseUrl - The base URL for the API
 * @returns {Response} The OpenAPI Explorer
 */
export function getOpenApiExplorer (baseUrl) {
  const configuration = {
    url: `${baseUrl}`,
    dom_id: '#swagger-ui',
    layout: 'BaseLayout',
    docExpansion: 'list',
    defaultModelsExpandDepth: 1,
    defaultModelRendering: 'model',
    showExtensions: true,
    persistAuthorization: true,
    deepLinking: true,
    displayOperationId: true,
    displayRequestDuration: false,
    tryItOutEnabled: true,
    requestSnippetsEnabled: true,
    syntaxHighlight: {
      active: true
    }
  }
  return new Response(
    `<html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>API Explorer</title>
        <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
      </head>
      <body x-data="main">
        <div class="w-full">
        <div id="swagger-ui"></div>
        </div>
        <script src="http://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js" crossorigin></script>
        <script>
        window.ui = SwaggerUIBundle(${JSON.stringify(configuration)});
        </script>
      </body>
    </html>`,
    {
      status: 200,
      headers: {
        'Content-Type': 'text/html'
      }
    })
}

const paths = {
  '/health': {
    get: {
      summary: 'Health check endpoint',
      description: 'Returns the health status of the API',
      tags: ['Monitoring'],
      responses: {
        200: {
          description: 'OK response indicating the service is healthy',
          content: {
            'text/plain': {
              schema: {
                type: 'string',
                example: 'OK'
              }
            }
          }
        }
      }
    }
  },
  '/routes': {
    get: {
      summary: 'Get routing table',
      description: 'Retrieves the current routing table. Requires API key authentication.',
      tags: ['Routing'],
      security: [
        {
          apiKeyAuth: []
        }
      ],
      responses: {
        200: {
          description: 'Successfully retrieved routing table',
          content: {
            'application/json': {
              schema: {
                type: 'array',
                items: {
                  type: 'object'
                },
                example: [
                  {
                    route: '/path',
                    destination: '/destination'
                  }
                ]
              }
            }
          }
        },
        401: {
          description: 'Unauthorized - Missing or invalid API key',
          content: {
            'text/plain': {
              schema: {
                type: 'string',
                example: 'Not authorized. API key invalid'
              }
            }
          }
        },
        404: {
          description: 'Not Found'
        }
      }
    },
    post: {
      summary: 'Update routing table',
      description: 'Updates the routing table with the provided data. Requires API key authentication.',
      tags: ['Routing'],
      security: [
        {
          apiKeyAuth: []
        }
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  route: {
                    type: 'string'
                  },
                  destination: {
                    type: 'string'
                  }
                },
                required: ['route', 'destination'],
                example: [
                  {
                    route: '/new-path',
                    destination: '/new-destination'
                  }
                ]
              }
            }
          }
        }
      },
      responses: {
        200: {
          description: 'Successfully updated routing table',
          content: {
            'text/plain': {
              schema: {
                type: 'string',
                example: 'OK'
              }
            }
          }
        },
        401: {
          description: 'Unauthorized - Missing or invalid API key',
          content: {
            'text/plain': {
              schema: {
                type: 'string',
                example: 'Not authorized. API key invalid'
              }
            }
          }
        },
        404: {
          description: 'Not Found'
        }
      }
    }
  }
}

/**
 * @function getOpenApiSpecification
 * @description Get the OpenAPI specification for the current version of the API.
 * @param {string} baseUrl - The base URL for the API
 * @returns {object} The OpenAPI specification for the current version of the API.
 */
export function getOpenApiSpecification (baseUrl) {
  return Response.json(
    {
      openapi: '3.1.0',
      info: {
        version: 1.0,
        title: pck.name,
        description: pck.description,
        contact: {
          name: pck.author
        },
        license: {
          name: pck.license,
          url: pck.homepage
        }
      },
      servers: [
        {
          url: baseUrl,
          description: `${pck.name} api v${pck.version}`
        }
      ],
      tags: [
        {
          name: 'Monitoring',
          description: 'Monitoring operations.'
        },
        {
          name: 'Routing',
          description: 'Routing operations.'
        }
      ],
      paths,
      components: {
        securitySchemes: {
          apiKeyAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'API key'
            // description: 'API key should be provided as \'Authorization: Bearer {apiKey}\''
          }
        }
      }
    },
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    }
  )
}
