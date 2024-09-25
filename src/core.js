import cluster from 'node:cluster'
import { ProxyError, ProxyErrorCause } from './libs/errors.js'
import { startPrimaryProcess, stopPrimaryProcess } from './primary-process.js'
import { startWorkerProcess } from './worker-process.js'
import { logger } from './libs/logger.js'

/** @typedef {import('./primary-process.js').PrimaryProcessOptions & import('./worker-process.js').WorkerProcessOptions} serverOptions */

/** @type {serverOptions} */
let serverOptions

/**
 * @function start
 * @description Start the proxy server
 * @param {serverOptions} options - The proxy server options
 * @returns {Promise<boolean>} True if the server started successfully
 */
export async function start ({
  clustering = 0,
  redis = {
    host: 'localhost',
    port: 6379,
    databaseIndex: 0,
    tls: false,
    password: ''
  },
  port = 8080,
  hostname = '0.0.0.0',
  api = {
    enabled: false,
    port: 8081,
    hostname: '0.0.0.0.',
    key: 'api'
  },
  serviceDiscovery = {
    strategy: 'none'
  },
  middlewares = {
    preProcessing: [],
    postProcessing: []
  },
  routingTable
}) {
  try {
    serverOptions = {
      clustering,
      redis,
      port,
      hostname,
      serviceDiscovery,
      api,
      routingTable
    }
    if (cluster.isPrimary) {
      return await startPrimaryProcess({
        clustering,
        redis,
        api,
        serviceDiscovery,
        routingTable
      })
    } else {
      if (cluster.isWorker) {
        return startWorkerProcess({
          port,
          hostname,
          redis,
          middlewares
        })
      } else {
        throw new ProxyServerError('Failed to start worker process',
          new ProxyErrorCause('Failed to start worker process', { port, hostname }, new Error('Unsupported cluster process type'))
        )
      }
    }
  } catch (error) {
    logger.error(error)
    throw new ProxyServerError('Failed to start the proxy server',
      new ProxyErrorCause('Failed to start the proxy server', { port, hostname }, error)
    )
  }
}

/**
 * @function stop
 * @description Stop the proxy server
 * @returns {Promise<boolean>} True if the server stopped successfully
 */
export async function stop () {
  try {
    return await stopPrimaryProcess()
  } catch (error) {
    throw new ProxyServerError('Failed to stop the proxy server',
      new ProxyErrorCause('Failed to stop the proxy server', null, error)
    )
  }
}

/**
 * @function getRoutingTable
 * @description Get the routing table
 * @returns {Promise<import('./libs/routing-table.js').RoutingTable>} The routing table
 * @throws {ProxyServerError} If the request failed
 */
export async function getRoutingTable () {
  try {
    if (!serverOptions.api) {
      throw new ProxyServerError('API is not enabled',
        new ProxyErrorCause('API is not enabled', null, new Error('API is not enabled'))
      )
    }
    const response = await fetch(`http://localhost:${serverOptions.api.port}/routes`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${serverOptions.api.key}`
      }
    })
    if (!response.ok) {
      throw new ProxyServerError('Failed to fetch the routing table',
        new ProxyErrorCause('Failed to fetch the routing table', null, new Error(response.statusText))
      )
    }
    return await response.json()
  } catch (error) {
    throw new ProxyServerError('Failed to get the routing table',
      new ProxyErrorCause('Failed to get the routing table', null, error)
    )
  }
}

/**
 * @function setRoutingTable
 * @description Update the routing table
 * @param {import('./libs/routing-table.js').RoutingTable} routingTable - The routing table
 * @returns {Promise<boolean>} True if the routing table was updated successfully
 */
export async function setRoutingTable (routingTable) {
  try {
    if (!serverOptions.api) {
      throw new ProxyServerError('API is not enabled',
        new ProxyErrorCause('API is not enabled', null, new Error('API is not enabled'))
      )
    }
    const response = await fetch(`http://localhost:${serverOptions.api.port}/routes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serverOptions.api.key}`
      },
      body: JSON.stringify(routingTable)
    })
    if (response.ok) {
      return true
    }
    throw new ProxyServerError('Failed to set the routing table',
      new ProxyErrorCause('Failed to set the routing table', { routingTable }, new Error(response.statusText))
    )
  } catch (error) {
    throw new ProxyServerError('Failed to set the routing table',
      new ProxyErrorCause('Failed to set the routing table', { routingTable }, error)
    )
  }
}

class ProxyServerError extends ProxyError { }
