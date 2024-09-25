import cluster from 'node:cluster'
import { cpus, availableParallelism } from 'node:os'
import { logger } from './libs/logger.js'
import { ProxyError, ProxyErrorCause } from './libs/errors.js'
import { setRoutingTable, propagateRoutingTableToWorkers } from './libs/routing-table.js'
import { discoverRoutesFromDocker } from './libs/discovery.js'
import { startApi, stopApi } from './libs/api.js'
import { stopQueues, initializeQueues } from './libs/queues.js'

const LOG_PREFIX = 'Primary:'

/** @type {Timer} */
let serviceDiscoveryTimer

/** @typedef {NoServiceDiscoveryStrategy|DockerServiceDiscoveryStrategy} ServiceDiscoveryStrategy */

/* @typedef {'none'|'docker'} ServiceDiscoveryStrategyType - The service discovery type */

/**
 * @typedef {object} NoServiceDiscoveryStrategy
 * @property {'none'} strategy - The service discovery strategy
 */

/**
 * @typedef {object} DockerServiceDiscoveryStrategy
 * @property {'docker'} strategy - The service discovery strategy
 * @property {number} refreshInterval - The service discovery refresh interval
 */

/**
 * @typedef {object} PrimaryProcessOptions
 * @property {number} [clustering] - The number of cluster processes (default: 0 = auto)
 * @property {import('./libs/queues.js').RedisConnectionOptions} redis - The Redis options
 * @property {import('./libs/api.js').ApiOptions} [api] - The API options
 * @property {ServiceDiscoveryStrategy} [serviceDiscovery] - The service discovery strategy
 * @property {import('./libs/routing-table.js').RoutingTable} [routingTable] - The proxy server routing table
 */

/**
 * @typedef {object} PrimaryProcessShutdownMessage
 * @property {'shutdown'} type - The message type
 */

/**
 * @typedef {object} PrimaryProcessUpdateRoutingTableMessage
 * @property {'routingtable'} type - The message type
 * @property {import('./libs/routing-table.js').RoutingTable} [routingTable] - The routing table
 */

/**
 * @function startPrimaryProcess
 * @description Start the primary process
 * @param {PrimaryProcessOptions} options - The start options
 * @returns {Promise<boolean>} True if the server started successfully
 * @throws {PrimaryProcessStartError} If the server failed to start
 */
export async function startPrimaryProcess ({
  clustering = 0,
  redis,
  api = {
    enabled: false,
    port: 8081,
    hostname: '0.0.0.0',
    key: 'api'
  },
  serviceDiscovery = {
    strategy: 'none'
  },
  routingTable
}) {
  registerSystemEventsHandlers()
  try {
    // API
    logger.debug({ api }, `Management API ${api.enabled ? 'enabled' : 'disabled'}`)
    if (api.enabled) {
      api.key = api.key || 'api'
      api.port = api.port || 8081
      api.hostname = api.hostname || '0.0.0.0'
      startApi(api)
    }

    // Define cluster parallelism
    let workersCount = 1
    const availableCpus = cpus().length
    switch (clustering) {
      // Auto, use the recommended number of processes
      case 0:
        // Use availableParallelism to get an estimate of the number of processes to use
        // instead of cpus to avoid using more processes than available cores
        // See: https://nodejs.org/api/os.html#osavailableparallelism
        workersCount = availableParallelism()
        break
      // Use the specified number of processes
      default:
        workersCount = clustering <= availableCpus ? clustering : availableCpus
        break
    }

    logger.info({ clustering, availableCpus, workersCount }, `${LOG_PREFIX} Starting...`)

    for (let i = 0; i < workersCount; i++) {
      const worker = cluster.fork()
      worker.on('listening',
        function workerProcessListeningHandler (worker, address) {
          logger.debug({ address, worker_id: worker.id }, `${LOG_PREFIX} Worker listening`)
        })
      worker.on('message',
        /**
         * @function workerProcessMessageHandler
         * @param {import('./primary-process.js').PrimaryProcessUpdateRoutingTableMessage} message - The message object
         */
        function workerProcessMessageHandler (message) {
          switch (message.type) {
            case 'routingtable':
              logger.debug({ worker_id: worker.id, message }, `${LOG_PREFIX} Worker message`)
              worker.send({
                type: 'routingtable',
                routingTable
              })
              break
          }
        })
      worker.on('online', function workerProcessOnlineHandler () {
        logger.debug({ worker_id: worker.id }, `${LOG_PREFIX} Worker is online`)
      })
      worker.on('disconnect', function workerProcessDisconnectHandler () {
        logger.debug({ worker_id: worker.id }, `${LOG_PREFIX} Worker disconnected`)
      })
      worker.on('error', function workerProcessErrorHandler (err) {
        logger.warn({ worker_id: worker.id, error: err }, `${LOG_PREFIX} Worker error`)
      })
      worker.on('exit', function workerProcessExitHandler (code, signal) {
        // Restart worker if it was not killed by the master
        if (receivedExitSignals === 0) {
          logger.warn({ code, signal, worker_id: worker.id }, `${LOG_PREFIX} Worker died, restarting...`)
          cluster.fork()
          // Repropagate the routing table to the new worker (and all others)
          propagateRoutingTableToWorkers()
        }
      })
      worker.on('fork', function workerProcessForkHandler (worker) {
        logger.debug({ worker_id: worker.id }, `${LOG_PREFIX} Worker forked`)
      })
    }

    // Initial routing table
    if (routingTable) {
      logger.debug({ routingTable }, `${LOG_PREFIX} Initial routing table`)
      setRoutingTable(routingTable)
    }

    // Queues
    initializeQueues(redis)

    // Service discovery
    logger.debug({ serviceDiscovery }, `${LOG_PREFIX} Service discovery`)
    switch (serviceDiscovery.strategy) {
      case 'docker':
        serviceDiscoveryTimer = setInterval(async () => {
          const discoveredRoutingTable = await discoverRoutesFromDocker()
          logger.debug({ discoveredRoutingTable }, `${LOG_PREFIX} Discovered routing table`)
          setRoutingTable(discoveredRoutingTable)
        }, serviceDiscovery.refreshInterval)
        break
      case 'none':
        logger.debug(`${LOG_PREFIX} No service discovery strategy`)
        break
      default:
        logger.warn(`${LOG_PREFIX} Invalid service discovery strategy`)
        break
    }

    return true
  } catch (error) {
    logger.error(error, `${LOG_PREFIX} Failed to start the primary process`)
    throw new PrimaryProcessStartError('Failed to start the primary process',
      new ProxyErrorCause('Failed to start the primary process', null, error)
    )
  }
}

/**
 * @function stopPrimaryProcess
 * @description Stop the primary process and all workers
 * @returns {Promise<boolean>} True if the server stopped successfully
 * @throws {PrimaryProcessStopError} If the server failed to stop
 */
export async function stopPrimaryProcess () {
  try {
    // Clear the discovery timer
    if (serviceDiscoveryTimer) { clearInterval(serviceDiscoveryTimer) }
    // Stop the management API
    stopApi()
    // Stop the queues
    await stopQueues()
    /** @type {PrimaryProcessShutdownMessage} */
    const shutdownMessage = ({ type: 'shutdown' })
    sendIpcMessageToWorkers(shutdownMessage)
    return true
  } catch (error) {
    logger.error(error, `${LOG_PREFIX} Failed to stop the primary process`)
    throw new PrimaryProcessStopError('Failed to stop the primary process',
      new ProxyErrorCause('Failed to stop the primary process', null, error)
    )
  }
}

/**
 * @function sendIpcMessageToWorkers
 * @description Send a message to all workers
 * @param {PrimaryProcessShutdownMessage|PrimaryProcessUpdateRoutingTableMessage} message - The message object
 * @returns {void}
 */
function sendIpcMessageToWorkers (message) {
  if (cluster.workers === undefined) {
    return
  }
  for (const worker of Object.values(cluster.workers)) {
    if (worker === undefined) {
      continue
    }
    worker.send(message)
  }
}

class PrimaryProcessStartError extends ProxyError { }
class PrimaryProcessStopError extends ProxyError { }

/**
 * Id used to check if a graceful exit has already been started
 * @type {number}
 */
let receivedExitSignals = 0

/**
 * @function registerSystemEventsHandlers
 * @description Configure process and register exit global handler
 * @see {@link https://nodejs.org/api/process.html#process_signal_events}
 * @see {@link http://man7.org/linux/man-pages/man7/signal.7.html}
 */
function registerSystemEventsHandlers () {
  try {
    // Prevent the program to close instantly to get some time to properly unload loaded services
    process.stdin.resume()
    // The 'beforeExit' event is emitted when Node.js empties its event loop and has no additional work to schedule.
    // Normally, the Node.js process will exit when there is no work scheduled, but a listener registered on
    // the 'beforeExit' event can make asynchronous calls, and thereby cause the Node.js process to continue.
    process.on('beforeExit', function beforeExitHandler (code) {
      gracefulExitHandler(code, 'BEFORE_EXIT', 'Node.js has an empty event loop and has no additional work to schedule')
    })
    // When app is closing
    process.on('exit', function exitHandler (code) {
      gracefulExitHandler(code, 'EXIT', 'App is closing')
    })
    // SIGINT is generated by the user pressing Ctrl+C and is an interrupt
    process.on('SIGINT', function sigintHandler (code) {
      gracefulExitHandler(code, 'SIGINT', 'User pressing Ctrl+C and is an interrupt')
    })
    // SIGTERM The SIGTERM signal is sent to a process to request its termination...
    process.on('SIGTERM', function sigtermHandler (code) {
      gracefulExitHandler(code, 'SIGTERM', 'Signal is sent to a process to request its termination')
    })
    // Catches "kill pid" (for example: nodemon restart)
    process.on('SIGUSR1', function sigusr1Handler (code) {
      gracefulExitHandler(code, 'SIGUSR1', '"kill pid" has been raised (for example: nodemon/pm2 restart)')
    })
    process.on('SIGUSR2', function sigusr2Handler (code) {
      gracefulExitHandler(code, 'SIGUSR2', '"kill pid" has been raised (for example: nodemon/pm2 restart)')
    })
    process.on('uncaughtException', function uncaughtExceptionHandler (err) {
      logger.error({ error: err }, `${LOG_PREFIX} Uncaught exception`)
      gracefulExitHandler('Uncaught exception', 'Uncaught exception', 'Uncaught exception')
    })
    process.on('unhandledRejection', function unhandledRejectionHandler (reason, promise) {
      logger.error({ reason, promise }, `${LOG_PREFIX} Unhandled rejection`)
      gracefulExitHandler('Unhandled rejection', 'Unhandled rejection', 'Unhandled rejection')
    })
  } catch (err) {
    logger.error({ error: err }, `${LOG_PREFIX} Unexpecter error registering system events handlers`)
    gracefulExitHandler('Unexpected error', 'Unexpected error', 'Unexpecter error registering system events handlers')
  }
}

/**
 * @function gracefulExitHandler
 * @description Handles unexpected platform exit events (uncaughtException, unhandledRejection, SIGINT, SIGTERM, etc.)
 * @param {string|number} exitCode - Exit code
 * @see {@link https://nodejs.org/api/process.html#process_exit_codes}
 * @param {string} exitMessage - Exit message
 * @param {string} exitDescription - Exit description
 */
async function gracefulExitHandler (exitCode, exitMessage, exitDescription) {
  // Time in ms to wait before exiting the program after receiving an exit signal.
  // Gives time the the program to unload properly each service.
  const GRACEFUL_EXIT_DELAY = 500
  try {
    const firstExitSignal = receivedExitSignals === 0
    // No exit signals received yet
    if (firstExitSignal) {
      receivedExitSignals = receivedExitSignals + 1
      logger.debug({ exitCode, exitMessage, exitDescription }, `${LOG_PREFIX} Received exit signal`)
      setTimeout(async () => {
        process.exitCode = 0
        process.exit()
      }, GRACEFUL_EXIT_DELAY)
      stopPrimaryProcess()
      logger.info(`${LOG_PREFIX} Graceful exit completed`)
    } else { // Timeout has already been set (multiple end signals)
      logger.debug({ exitCode, exitMessage, exitDescription }, `${LOG_PREFIX} Received additional exit signal`)
    }
  } catch (err) {
    logger.error({ error: err }, `${LOG_PREFIX} Unexpected error during teardown`)
  }
}
