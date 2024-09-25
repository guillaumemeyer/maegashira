import { serve } from 'bun'
import { getRoutingTable, setRoutingTable } from './routing-table.js'
import { logger } from './logger.js'

/** @type {import('bun').Server} */
let apiServer

/**
 * @typedef {object} ApiOptions
 * @property {boolean} enabled - Enable the API
 * @property {number} port - The API port
 * @property {string} hostname - The API hostname
 * @property {string} [key] - The API key
 */

/** @type {ApiOptions} */
let apiOptions

/**
 * @function apiRequestHandler
 * @description Handle incoming management API requests
 * @param {Request} req - The incoming request
 * @returns {Promise<Response>} - The response to the request
 */
export async function apiRequestHandler (req) {
  const url = new URL(req.url)

  // Anonmyous endpoints
  if (url.pathname === '/health') {
    return new Response('OK', { status: 200 })
  }

  // Authenticate endpoints
  const authorizationHeader = req.headers.get('Authorization')
  if (!authorizationHeader) {
    return new Response('Not authorized. Missing "Authorization" header', { status: 401 })
  }
  const requestApiKey = authorizationHeader.split(' ')[1]
  if (!requestApiKey) {
    return new Response('Not authorized. Missing API key', { status: 401 })
  }
  if (requestApiKey !== apiOptions.key) {
    return new Response('Not authorized. API key invalid', { status: 401 })
  }

  if (req.method === 'GET' && url.pathname === '/routes') {
    return Response.json(getRoutingTable(), { status: 200 })
  }

  if (req.method === 'POST' && url.pathname === '/routes') {
    /** @type {import('./routing-table.js').RoutingTable} */
    const routingTable = await req.json()
    setRoutingTable(routingTable)
    return new Response('OK', {
      status: 200
    })
  }

  return new Response('Not found', { status: 404 })
}

/**
 * @function startApi
 * @description Initialize the management API
 * @param {ApiOptions} options - The API options
 */
export function startApi (options) {
  try {
    apiOptions = options
    apiServer = serve({
      port: options.port,
      hostname: options.hostname,
      fetch: apiRequestHandler
    })
    logger.info(options, `Management API started on ${options.hostname}:${options.port}`)
  } catch (error) {
    logger.error(error, 'Failed to start the management API')
  }
}

/**
 * @function stopApi
 * @description Stop the management API
 */
export function stopApi () {
  // Stop the server and close all connections
  if (apiServer) {
    apiServer.stop(true)
  }
}
