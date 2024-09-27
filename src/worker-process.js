import process from 'node:process'
import { Worker } from 'bullmq'
import { randomUUID } from 'node:crypto'
import { serve, file, env } from 'bun'
import { logger, logLevel } from './libs/logger.js'
import { initializeQueues, queues, createPostTransactionJob } from './libs/queues.js'
import { ProxyError, ProxyErrorCause } from './libs/errors.js'
import { collectDefaultMetrics, Counter } from 'prom-client'

// Ignored because importing json with assertions is not supported by eslint
// @ts-ignore
import pck from '../package.json'
import { URL } from 'node:url'

const LOG_PREFIX = 'Worker:'

// Enable collection of default metrics
collectDefaultMetrics({
  // These are the default buckets
  gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5]
})

const responsesCodesCounter = new Counter({
  name: 'responses_codes',
  help: 'Example of a histogram',
  labelNames: ['code']
})

/** @type {import('bun').Server} */
let proxyServer

/** @type {import('./libs/routing-table.js').RoutingTable} */
let routingTable = []

/**
 * @typedef {object} Middlewares
 * @property {PreProcessingMiddleware[]} preProcessing - The pre-processing middlewares
 * @property {PostProcessingMiddleware[]} postProcessing - The post-processing middlewares
 */

/** @typedef {'next'|'cancel'} MiddlewareAction */

/**
 * @typedef {object} PreProcessingMiddlewareState
 * @property {Transaction} transaction - The transaction
 * @property {object} headers - The request headers
 * @property {object|string} body - The request body
 * @property {MiddlewareAction} [action] - The action
 * @property {TransactionCancellationReason} [cancellationReason] - The reason for the cancellation
 */

/**
 * @typedef {object} PostProcessingMiddlewareState
 * @property {Transaction} transaction - The transaction
 * @property {object} headers - The response headers
 * @property {object|string} body - The response body
 * @property {MiddlewareAction} [action] - The action
 * @property {TransactionCancellationReason} [cancellationReason] - The reason for the cancellation
 */

/**
 * @typedef {object} PreProcessingMiddleware
 * @property {string} key - The middleware key
 * @property {Function} handler - The middleware handler
 */

/**
 * @typedef {object} PostProcessingMiddleware
 * @property {string} key - The middleware key
 * @property {Function} handler - The middleware handler
 */

/** @type {Middlewares} */
let registeredMiddlewares = {
  preProcessing: [],
  postProcessing: []
}

/**
 * @typedef {object} WorkerProcessOptions
 * @property {number} [port] - The proxy server port
 * @property {string} [hostname] - The proxy server hostname
 * @property {import('./libs/queues.js').RedisConnectionOptions} redis - The Redis options
 * @property {Middlewares} [middlewares] - The middlewares
 */

/**
 * @function startWorkerProcess
 * @description Start the worker process
 * @param {WorkerProcessOptions} options - The worker process options
 * @returns {boolean} True if the server started successfully
 * @throws {WorkerProcessStartError} If the server failed to start
 */
export function startWorkerProcess ({
  port = 8080,
  hostname = '0.0.0.0',
  redis,
  middlewares
}) {
  try {
    if (middlewares) {
      registeredMiddlewares = middlewares
    }

    // Proxy server
    proxyServer = serve({
      port,
      hostname,
      fetch: requestHandler,
      error: errorHandler
    })

    logger.info({ hostname, port }, `${LOG_PREFIX} Listening on ${hostname}:${port}`)

    // Listen for messages from the primary process
    process.on('message',
      /**
       * @function primmaryProcessMessageHandler
       * @description Handles messages sent from the primary process of the cluster
       * @param {import('./primary-process.js').PrimaryProcessShutdownMessage|import('./primary-process.js').PrimaryProcessUpdateRoutingTableMessage|import('./primary-process.js').PrimaryProcessMetricsRequestMessage} message - The message object
       */
      function primmaryProcessMessageHandler (message) {
        switch (message.type) {
          case 'shutdown':
            try {
              // Stop the server and close all connections
              if (proxyServer) { proxyServer.stop(true) }
            } catch (error) {
              throw new WorkerProcessStopError('Failed to stop the worker process',
                new ProxyErrorCause('Failed to stop the worker process', { port, hostname }, error)
              )
            }
            break
          case 'routingtable':
            // Update the routing table
            if (message.routingTable) { routingTable = message.routingTable }
            logger.debug({ routingTable: message.routingTable }, `${LOG_PREFIX} Routing table updated`)
            break
          case 'prom-client:getMetricsReq':
            logger.debug({ message }, `${LOG_PREFIX} Received request for metrics from the primary process`)
            break
          default:
            logger.warn({ message }, `${LOG_PREFIX} Unknown message type received from the primary process`)
            break
        }
      }
    )
    // Request the routing table from the primary process
    if (process.send) {
      process.send({ type: 'routingtable' })
    }

    // Queues
    const redisConnection = initializeQueues(redis)
    const postTransactionWorker = new Worker(queues.postTransaction, postTransactionProcessor, {
      connection: redisConnection
    })
    postTransactionWorker.on('completed', job => {
      logger.debug({ jobId: job.id }, `${LOG_PREFIX} Job ${job.id} completed`)
    })
    postTransactionWorker.on('failed', (job, error) => {
      if (job) {
        logger.error({ error, jobId: job.id }, `${LOG_PREFIX} Job ${job.id} failed`)
      } else {
        logger.error(error, `${LOG_PREFIX} Undefined job failed`)
      }
    })

    logger.debug({ hostname, port }, 'Worker started')
    return true
  } catch (error) {
    throw new WorkerProcessStartError('Failed to start the worker process',
      new ProxyErrorCause('Failed to start the worker process', { port, hostname }, error)
    )
  }
}

/**
 * @function errorHandler
 * @description Handle errors
 * @param {Error} error - The error
 * @returns {Response} The response to the error
 */
function errorHandler (error) {
  logger.error(error)
  return new Response(error.message, { status: 500 })
}

/** @type {import('bullmq').Processor} */
export const postTransactionProcessor = async (job) => {
  try {
    await job.updateProgress(1)
    const transaction = job.data
    await job.log(`Processing transaction ${transaction}`)
    await job.updateProgress(100)
    return true
  } catch (err) {
    logger.error(err, `${LOG_PREFIX} Error processing post-transaction job ${job.id}`)
    throw err
  }
}

/** @typedef {TransactionMetadata & RequestMetadata & TargetMetadata &  ResponseMetadata} Transaction */

/** @typedef {'fetch_failed'|'timeout'|'route_match'|'middleware_cancelled'|string} TransactionCancellationReason */

/**
 * @typedef {object} TransactionMetadata
 * @property {string} transaction_id - The auto-generated transaction ID
 * @property {string} transaction_start - The transaction start time
 * @property {boolean} [transaction_cancelled] - The transaction cancelled status
 * @property {TransactionCancellationReason} [transaction_cancellation_reason] - The transaction cancellation reason
 * @property {import('./libs/routing-table.js').TargetType} [target_type] - The target type
 * @property {'no-cache'|'match'|'miss'} [transaction_cache] - The transaction cache status
 * @property {string} [transaction_end] - The transaction end time
 * @property {number} [transaction_duration] - The transaction duration
 * @property {string} [transaction_resolving_start] - The resolving start time
 * @property {string} [transaction_resolving_end] - The resolving end time
 * @property {number} [transaction_resolving_duration] - The resolving duration
 * @property {string} [transaction_preprocessing_start] - The preprocessing start time
 * @property {string} [transaction_preprocessing_end] - The preprocessing end time
 * @property {number} [transaction_preprocessing_duration] - The preprocessing duration
 * @property {string} [transaction_postprocessing_start] - The postprocessing start time
 * @property {string} [transaction_postprocessing_end] - The postprocessing end time
 * @property {number} [transaction_postprocessing_duration] - The postprocessing duration
 * @property {number} [transaction_total_overhead] - The total overhead in ms (duration - resolving_duration - preprocessing_duration - postprocessing_duration)
 * @property {number} [transaction_overhead_percentage] - The overhead percentage
 */

/**
 * @typedef {object} RequestMetadata
 * @property {string} [request_client_ip] - The IP address
 * @property {string} [request_method] - The request method
 * @property {string} [request_url] - The request URL
 * @property {string} [request_user_agent] - The user agent
 * @property {number} [request_bytes] - The number of bytes in the request
 */

/**
 * @typedef {object} TargetMetadata
 * @property {string} [target_request_start] - The target request start time
 * @property {string} [target_request_end] - The target request end time
 * @property {number} [target_request_duration] - The target request duration
 */

/**
 * @typedef {object} ResponseMetadata
 * @property {number} [response_status] - The response status
 * @property {string} [response_status_text] - The response status text
 * @property {number} [response_bytes] - The number of bytes in the response
 */

/**
 * @function requestHandler
 * @description Handle incoming requests
 * @param {Request} request - The incoming request
 * @param {import('bun').Server} server - The server instance
 * @returns {Promise<Response>} - The response to the request
 */
async function requestHandler (request, server) {
  /** @type {Transaction} */
  const transaction = {
    transaction_id: randomUUID(),
    transaction_start: new Date().toISOString()
  }
  try {
    const url = new URL(request.url)

    if (!server) {
      throw new Error('Server instance is not available',
        new ProxyErrorCause('Server instance is not available', { request }, new Error('Server instance is not available'))
      )
    }

    const requestedIp = server.requestIP(request)
    if (!requestedIp?.address) {
      throw new Error('Failed to get the client IP address',
        new ProxyErrorCause('Failed to get the client IP address', { request }, new Error('Failed to get the client IP address'))
      )
    }
    transaction.request_client_ip = requestedIp.address
    transaction.request_method = request.method
    transaction.request_url = request.url
    transaction.request_user_agent = String(request.headers.get('user-agent'))
    transaction.request_bytes = Number(request.headers.get('content-length')) || 0

    /** @type {Response} */
    let response = new Response('Unknown error', { status: 500 })

    // TODO: Execute custom resolver
    transaction.transaction_resolving_start = new Date().toISOString()
    // Find the route that matches the request
    const route = matchRoute(url.hostname, url.pathname)
    transaction.transaction_resolving_end = new Date().toISOString()
    transaction.transaction_resolving_duration = new Date(transaction.transaction_resolving_end).getTime() - new Date(transaction.transaction_resolving_start).getTime()

    if (!route) {
      /** @type {Response} */
      response = new Response('Route not found', { status: 404 })
      transaction.transaction_cancelled = true
      transaction.transaction_cancellation_reason = 'route_match'
    } else {
      /** @type {import('./libs/routing-table.js').Target} */
      let target

      if (route.loadBalancingStrategy) {
        switch (route?.loadBalancingStrategy?.type) {
          case 'random':
            target = route.targets[Math.floor(Math.random() * route.targets.length)]
            break
          default:
            logger.warn({ route }, 'Unknown load balancing strategy, using default')
            target = route.targets[Math.floor(Math.random() * route.targets.length)]
        }
      } else {
        logger.debug({ route }, 'No load balancing strategy defined, using default')
        target = route.targets[Math.floor(Math.random() * route.targets.length)]
      }

      let authenticated = false

      // TODO: Implement cache strategy
      transaction.transaction_cache = 'no-cache'

      // Execute pre-processing middleware
      // Only do this after the route is resolved and cache is checked
      if (route?.middlewares?.preProcessing && route.middlewares.preProcessing.length > 0) {
        transaction.transaction_preprocessing_start = new Date().toISOString()
        let shouldCancel = false
        for (const middlewareKey of route.middlewares.preProcessing) {
          const middlewareFindResult = registeredMiddlewares.preProcessing.find(m => m.key === middlewareKey)
          if (middlewareFindResult) {
            /** @type {PreProcessingMiddleware} */
            const middleware = middlewareFindResult
            if (middleware.handler) {
              const middlewareHandler = middleware.handler
              /** @type {PreProcessingMiddlewareState} */
              const initialState = {
                transaction,
                headers: request.headers.toJSON(),
                body: request.body,
                action: 'next'
              }
              /** @type {PreProcessingMiddlewareState} */
              const updatedState = await middlewareHandler(initialState)
              switch (updatedState?.action) {
                case 'cancel':
                  logger.debug({ middlewareKey }, 'Middleware cancelled the transaction')
                  transaction.transaction_cancelled = true
                  transaction.transaction_cancellation_reason = updatedState.cancellationReason || `Cancelled by ${middlewareKey}`
                  response = new Response('Request cancelled', { status: 400 })
                  shouldCancel = true
                  break
                case 'next':
                  // Remove all request headers
                  request.headers.forEach((value, key) => {
                    request.headers.delete(key)
                  })
                  // Add the updated headers
                  updatedState.headers.forEach((value, key) => {
                    request.headers.set(key, value)
                  })
                  logger.debug({ middlewareKey }, 'Middleware passed the transaction')
                  break
                default:
                  logger.warn({ middlewareKey }, 'Unknown middleware action')
                  break
              }
            } else {
              logger.warn({ middlewareKey }, 'Middleware not found')
            }
          }
          if (shouldCancel) {
            break
          }
        }
        transaction.transaction_preprocessing_end = new Date().toISOString()
        transaction.transaction_preprocessing_duration = new Date(transaction.transaction_preprocessing_end).getTime() - new Date(transaction.transaction_preprocessing_start).getTime()
      } else {
        transaction.transaction_preprocessing_duration = 0
      }

      if (route.authenticationStrategy) {
        /** @type {null|Response} */
        let authResponse = null
        switch (route.authenticationStrategy.type) {
          case 'anonymous':
            break
          case 'basic':
            authResponse = basicAuthenticationMiddleware({
              req: request,
              validUser: route.authenticationStrategy.username,
              validPassword: route.authenticationStrategy.password
            })
            break
          default:
            logger.warn({ route }, 'Unknown authentication strategy, using default')
            break
        }
        if (authResponse) {
          response = authResponse
          authenticated = false
        } else {
          authenticated = true
        }
      } else { // No authentication strategy
        authenticated = true
      }

      if (authenticated) {
        transaction.target_type = target.type

        // Serve the target URL
        if (target.type === 'forward') {
          const targetPath = url.pathname.replace(route.path, '')
          // Build the target URL preserving the path and query string
          const targetUrl = `${target.url}${targetPath}${url.search}`
          const targetHost = new URL(target.url).host
          // Create a new request object with the target URL
          const proxyRequest = new Request(targetUrl, {
            method: request.method,
            headers: request.headers,
            body: request.body
          })
          // TODO: Make the user agent configurable
          proxyRequest.headers.set('User-Agent', `${pck.name}/${pck.version}`)
          // Add host header to the request
          proxyRequest.headers.set('host', targetHost)

          // See: https://bun.sh/blog/bun-v1.1.27#per-request-timeouts
          const controller = new AbortController()
          const timeoutId = setTimeout(function () {
            controller.abort()
          }, route.timeout || Number(env.MAEGASHIRA_TIMEOUT) || 5000)

          /** @type {Response} */
          let proxyResponse
          try {
            transaction.target_request_start = new Date().toISOString()
            // Execute the request
            proxyResponse = await fetch(proxyRequest, {
              // TODO: Fix verbose not being recognized
              // @ts-ignore
              verbose: logLevel === 'debug',
              signal: controller.signal,
              redirect: 'follow',
              follow: 20
            })
            transaction.target_request_end = new Date().toISOString()
            transaction.target_request_duration = new Date(transaction.target_request_end).getTime() - new Date(transaction.target_request_start).getTime()
            // Clear the timeout when the response is received
            clearTimeout(timeoutId)
            // TODO: Make cors configurable
            proxyResponse.headers.set('Access-Control-Allow-Origin', '*')
            proxyResponse.headers.set('Access-Control-Allow-Methods', '*') // 'GET, POST, PUT, DELETE, OPTIONS')

            // Adjust the content-encoding header to avoid compression issues
            proxyResponse.headers.set('content-encoding', 'identity')
            response = proxyResponse
          } catch (error) {
            // @ts-ignore
            if (error?.name === 'AbortError') {
              logger.debug({ transaction }, 'Request timed out')
              transaction.transaction_cancelled = true
              transaction.transaction_cancellation_reason = 'timeout'
              response = new Response('Request timed out', { status: 504 })
            } else {
              transaction.transaction_cancelled = true
              transaction.transaction_cancellation_reason = 'fetch_failed'
              response = new Response('Failed to fetch the target URL', { status: 500 })
            }
          }
        }

        // Serve static files
        if (target.type === 'static') {
          // Check if we have to include the index file
          let indexFile = ''
          if (url.pathname === '/' || url.pathname.endsWith('/')) {
            indexFile = target.index || 'index.html'
          }
          const staticFile = file(`${target.directory}${url.pathname}${indexFile}`)
          const fileExists = await staticFile.exists()
          if (!fileExists) {
            response = new Response('Not found', { status: 404 })
          } else {
            response = new Response(staticFile)
          }
        }
      }
    }

    // Execute post-processing middleware
    if (route?.middlewares?.postProcessing) {
      transaction.transaction_postprocessing_start = new Date().toISOString()
      transaction.transaction_postprocessing_end = new Date().toISOString()
      transaction.transaction_postprocessing_duration = new Date(transaction.transaction_postprocessing_end).getTime() - new Date(transaction.transaction_postprocessing_start).getTime()
    } else {
      transaction.transaction_postprocessing_duration = 0
    }

    transaction.transaction_end = new Date().toISOString()
    transaction.transaction_duration = new Date(transaction.transaction_end).getTime() - new Date(transaction.transaction_start).getTime()
    if (transaction.target_request_duration) {
      transaction.transaction_total_overhead = transaction.transaction_duration - transaction.target_request_duration
    }
    if (transaction.transaction_total_overhead) {
      transaction.transaction_overhead_percentage = (transaction.transaction_total_overhead / transaction.transaction_duration) * 100
    }

    transaction.response_status = response.status
    transaction.response_status_text = response.statusText
    transaction.response_bytes = Number(response.headers.get('content-length')) || 0
    // Add performance headers in debug mode
    if (logLevel === 'debug') {
      response.headers.set(`x-${pck.name}-transaction-id`, transaction.transaction_id)
      response.headers.set(`x-${pck.name}-transaction-cache`, String(transaction.transaction_cache))
      response.headers.set(`x-${pck.name}-transaction-duration`, String(transaction.transaction_duration))
      response.headers.set(`x-${pck.name}-transaction-overhead`, String(transaction.transaction_total_overhead))
      response.headers.set(`x-${pck.name}-transaction-overhead-percentage`, String(transaction.transaction_overhead_percentage))
    }

    responsesCodesCounter.inc({ code: response.status })

    return response
  } catch (error) {
    logger.error(error)
    logger.error({ transaction }, 'Failed to handle the request')
    throw new ProxyRequestError('Failed to handle the request',
      new ProxyErrorCause('Failed to handle the request', { transaction }, error)
    )
  } finally {
    transaction.transaction_end = new Date().toISOString()
    transaction.transaction_duration = new Date(transaction.transaction_end).getTime() - new Date(transaction.transaction_start).getTime()
    const postTransactionJob = await createPostTransactionJob({ transaction })
    logger.debug(`${LOG_PREFIX} Job ${postTransactionJob.id} created`)
  }
}

/**
 * @function matchRoute
 * @description Match the route based on the hostname and path
 * @param {string} hostname - The hostname
 * @param {string} path - The path
 * @returns {import('./libs/routing-table.js').Route|null} The matched route
 * @throws {RoutingError} If the route matching failed
 * @see https://bun.red/docs/api/glob
 */
export function matchRoute (hostname, path) {
  try {
    logger.debug({ host: hostname, path, routingTable }, 'Match the route')
    for (const route of routingTable) {
      if (route.hostname === hostname && path.startsWith(route.path)) {
        return route
      }
    }
    return null
  } catch (error) {
    throw new RoutingError('Failed to match the route',
      new ProxyErrorCause('Failed to match the route', { hostname, path }, error)
    )
  }
}

class RoutingError extends ProxyError { }

/**
 * @function basicAuthenticationMiddleware
 * @description Basic authentication middleware
 * @param {object} options - The options
 * @param {Request} options.req - The incoming request
 * @param {string} options.validUser - The valid user
 * @param {string} options.validPassword - The valid password
 * @returns {null|Response} The response if the authentication failed
 */
function basicAuthenticationMiddleware ({
  req,
  validUser,
  validPassword
}) {
  // TODO: Generate a dynamic realm based on the hostname
  const url = new URL(req.url)
  const realm = url.hostname
  const authorizationHeader = req.headers.get('Authorization')
  if (!authorizationHeader) {
    return new Response('Not authorized', {
      headers: {
        'WWW-Authenticate': `Basic realm="${realm}"`
      },
      status: 401
    })
  }
  const encodedAuthorizationString = authorizationHeader.split(' ')[1]
  const decodedAuthorizationString = atob(encodedAuthorizationString)
  const requestUser = decodedAuthorizationString.split(':')[0]
  const requestPassword = decodedAuthorizationString.split(':')[1]
  if (requestUser !== validUser || requestPassword !== validPassword) {
    return new Response('Not authorized', {
      headers: {
        'WWW-Authenticate': `Basic realm="${realm}"`
      },
      status: 401
    })
  }
  return null
}

class WorkerProcessStartError extends ProxyError { }
class WorkerProcessStopError extends ProxyError { }
class ProxyRequestError extends ProxyError { }
