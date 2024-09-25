import cluster from 'node:cluster'
import { dns } from 'bun'
import { ProxyError, ProxyErrorCause } from './errors.js'
import { logger } from './logger.js'
import { Ajv } from 'ajv'
import addFormats from 'ajv-formats'

const ajv = new Ajv({ allErrors: true })
addFormats.default(ajv, ['hostname', 'uri'])

const routingTableSchema = {
  description: 'Routing table',
  type: 'array',
  items: {
    description: 'Route',
    type: 'object',
    properties: {
      hostname: {
        type: 'string',
        description: 'The host name pattern',
        format: 'hostname'
      },
      path: {
        type: 'string',
        description: 'The path pattern'
      },
      timeout: {
        type: 'number',
        description: 'The request timeout'
      },
      middlewares: {
        description: 'The pre-processing and post-processing middlewares',
        type: 'object',
        properties: {
          preProcessing: {
            description: 'An array of pre-processing middlewares keys',
            type: 'array',
            items: {
              type: 'string'
            }
          },
          postProcessing: {
            description: 'An array of post-processing middlewares keys',
            type: 'array',
            items: {
              type: 'string'
            }
          }
        },
        required: [],
        additionalProperties: false
      },
      loadBalancingStrategy: {
        oneOf: [
          {
            description: 'Random load balancing strategy',
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['random']
              }
            },
            required: ['type'],
            additionalProperties: false
          }
        ]
      },
      authenticationStrategy: {
        oneOf: [
          {
            description: 'Anonymous authentication strategy',
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['anonymous']
              }
            },
            required: ['type'],
            additionalProperties: false
          },
          {
            description: 'Basic authentication strategy',
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['basic']
              },
              username: {
                type: 'string',
                description: 'The basic authentication username'
              },
              password: {
                type: 'string',
                description: 'The basic authentication password'
              },
              realm: {
                type: 'string',
                description: 'The basic authentication realm'
              }
            },
            required: ['type', 'username', 'password'],
            additionalProperties: false
          }
        ]
      },
      cacheStrategy: {
        oneOf: [
          {
            description: 'No cache strategy',
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['no-cache']
              }
            },
            required: ['type'],
            additionalProperties: false
          },
          {
            description: 'Basic cache strategy',
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['basic']
              },
              ttl: {
                type: 'number',
                description: 'The cache time-to-live in milliseconds'
              }
            },
            required: ['type', 'ttl'],
            additionalProperties: false
          }
        ]
      },
      targets: {
        type: 'array',
        items: {
          oneOf: [
            {
              description: 'Forward target',
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['forward']
                },
                url: {
                  type: 'string',
                  description: 'The target URL',
                  format: 'uri'
                }
              },
              required: ['type', 'url'],
              additionalProperties: false
            },
            {
              description: 'Static target',
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['static']
                },
                directory: {
                  type: 'string',
                  description: 'The target directory containing static files'
                },
                index: {
                  type: 'string',
                  description: 'The target default index file'
                }
              },
              required: ['type', 'directory'],
              additionalProperties: false
            }
          ]
        },
        minItems: 1,
        description: 'The targets'
      }
    },
    required: ['hostname', 'path', 'targets'],
    additionalProperties: false
  }
}
const validateRoutingTableSchema = ajv.compile(routingTableSchema)

/**
 * @typedef {object} Middlewares
 * @property {string[]} [preProcessing] - The pre-processing URL
 * @property {string[]} [postProcessing] - The post-processing URL
 */

/** @typedef {Route[]} RoutingTable */

/** @typedef {RandomLoadBalancingStrategy} LoadBalancingStrategy */

/**
 * @typedef {object} RandomLoadBalancingStrategy
 * @property {'random'} type - The load balancing strategy type
 */

/** @typedef {'random'} LoadBalancingStrategyType */

/** @typedef {AnonymousAuthenticationStrategy|BasicAuthenticationStrategy} AuthenticationStrategy */

/**
 * @typedef {object} AnonymousAuthenticationStrategy
 * @property {'anonymous'} type - The authentication strategy type
 */

/**
 * @typedef {object} BasicAuthenticationStrategy
 * @property {'basic'} type - The authentication strategy type
 * @property {string} username - The basic authentication username
 * @property {string} password - The basic authentication password
 * @property {string} [realm] - The basic authentication realm
 */

/** @typedef {'anonymous'|'basic'} AuthenticationStrategyType */

/**
 * @typedef {NoCacheStrategy|BasicCacheStrategy} CacheStrategy
 */

/**
 * @typedef {object} NoCacheStrategy
 * @property {'no-cache'} type - The cache strategy type
 */

/**
 * @typedef {object} BasicCacheStrategy
 * @property {'basic'} type - The cache strategy type
 * @property {number} ttl - The cache time-to-live in milliseconds
 */

/**
 * @typedef {object} Route
 * @property {string} hostname - The host name pattern
 * @property {string} path - The path pattern (default: '')
 * @property {number} [timeout] - The request timeout (default: 5000)
 * @property {Middlewares} [middlewares] - The pre-processing and post-processing middlewares
 * @property {LoadBalancingStrategy} [loadBalancingStrategy] - The load balancing strategy
 * @property {AuthenticationStrategy} [authenticationStrategy] - The authentication strategy
 * @property {CacheStrategy} [cacheStrategy] - The cache strategy
 * @property {Target[]} targets - The targets
 */

/**
 * @typedef {'forward'|'redirect'|'static'} TargetType
 */

/**
 * @typedef {object} ForwardTarget
 * @property {'forward'} type - The target type
 * @property {string} url - The target URL
 */

/**
 * @typedef {object} RedirectTarget
 * @property {'redirect'} type - The target type
 * @property {string} url - The target URL
 */

/**
 * @typedef {object} StaticTarget
 * @property {'static'} type - The target type
 * @property {string} directory - The target directory containing static files
 * @property {string} [index] - The target default index file (default: index.html)
 */

/**
 * @typedef {ForwardTarget|RedirectTarget|StaticTarget} Target
 */

/** @type {RoutingTable} */
let _routingTable

/**
 * @function setRoutingTable
 * @description Set the proxy server routes
 * @param {RoutingTable} routingTable - The proxy server routes
 * @returns {void}
 */
export function setRoutingTable (routingTable) {
  try {
    if (!validateRoutingTableSchema(routingTable)) {
      logger.warn({ level: 'error', message: 'Invalid routing table.', errors: validateRoutingTableSchema.errors })
      throw new RoutingTableError('Invalid routing table',
        new ProxyErrorCause('Invalid routing table', {
          routingTable,
          errors: validateRoutingTableSchema.errors
        }, null)
      )
    }
    _routingTable = routingTable
    propagateRoutingTableToWorkers()
    prefetchDns()
  } catch (error) {
    logger.error(error)
    throw new RoutingTableError('Failed to set the routing table',
      new ProxyErrorCause('Failed to set the routing table', { routingTable }, error)
    )
  }
}

/**
 * @function checkRoutingTable
 * @description Check the routing table for errors
 * @param {RoutingTable} routingTable - The routing table to check
 * @returns {null|import('ajv').ErrorObject[]} The routing
 */
export function checkRoutingTable (routingTable) {
  if (!validateRoutingTableSchema(routingTable)) {
    /** @type {import('ajv').ErrorObject[]} */
    const errors = []
    if (validateRoutingTableSchema.errors && validateRoutingTableSchema.errors.length > 0) {
      for (const error of validateRoutingTableSchema.errors) {
        errors.push(error)
      }
    }
    return errors
  }
  return null
}

/**
 * @function propagateRoutingTableToWorkers
 * @description Propagate the routing table to all workers
 * @returns {void}
 */
export function propagateRoutingTableToWorkers () {
  try {
    const routingTable = getRoutingTable()
    /** @type {import('../primary-process.js').PrimaryProcessUpdateRoutingTableMessage} */
    const message = { type: 'routingtable', routingTable }
    if (cluster.workers === undefined) {
      return
    }
    for (const worker of Object.values(cluster.workers)) {
      if (worker === undefined) {
        continue
      }
      worker.send(message)
    }
  } catch (error) {
    logger.error(error)
    throw new RoutingTableError('Failed to propagate the routing table to workers',
      new ProxyErrorCause('Failed to propagate the routing table to workers', null, error)
    )
  }
}

class RoutingTableError extends ProxyError { }

/**
 * @function getRoutingTable
 * @description List the proxy server routes
 * @returns {RoutingTable} The proxy server routes
 */
export function getRoutingTable () {
  return _routingTable || []
}

/**
 * @function prefetchDns
 * @description Prefetch all DNS records from all targets
 * @returns {void}
 * @see https://bun.sh/docs/api/fetch#dns-prefetching
 */
export function prefetchDns () {
  const hosts = []
  for (const route of _routingTable) {
    for (const target of route.targets) {
      if (target.type === 'forward') {
        if (!target.url) {
          continue
        }
        const targetHost = new URL(target.url).host
        if (!hosts.includes(targetHost)) {
          hosts.push(targetHost)
        }
      }
    }
  }
  for (const host of hosts) {
    dns.prefetch(host)
  }
}
