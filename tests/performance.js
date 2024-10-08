// import autocannon from 'autocannon'
import { env, spawn } from 'bun'

let proxyProc

try {
  registerSystemEventsHandlers()

  env.MAEGASHIRA_HOSTNAME = '0.0.0.0'
  env.MAEGASHIRA_PORT = '8080'
  env.MAEGASHIRA_CLUSTERING = '1'
  env.MAEGASHIRA_REDIS_HOST = 'localhost'
  env.MAEGASHIRA_REDIS_PORT = '6379'
  env.MAEGASHIRA_REDIS_PASSWORD = 'password'
  env.MAEGASHIRA_API_ENABLED = 'true'
  env.MAEGASHIRA_API_HOSTNAME = '0.0.0.0'
  env.MAEGASHIRA_API_PORT = '8081'
  env.MAEGASHIRA_API_KEY = 'secret'

  console.log(import.meta.dirname)
  proxyProc = spawn(['bun', '../src/cli.js', 'start'], {
    cwd: import.meta.dirname,
    env,
    onExit (proc, exitCode, signalCode, error) {
      console.log('Exit code:', exitCode)
    }
  })

  setTimeout(async () => {
    const updateRoutesResponse = await fetch('http://localhost:8081/routes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret'
      },
      body: JSON.stringify([
        {
          hostname: 'localhost',
          path: '',
          targets: [
            {
              type: 'static',
              directory: import.meta.dirname
            }
          ]
        }
      ])
    })
    if (!updateRoutesResponse.ok) {
      console.error(await updateRoutesResponse.text())
      throw new Error('Failed to update routes')
    }
  }, 500)

  // proxyProc.kill(0)

  // const result = await autocannon({
  //   url: 'http://localhost:18083/performance.js',
  //   connections: 10,
  //   pipelining: 1,
  //   duration: 10,
  //   workers: 4
  // })

  // autocannon.printResult(result, {
  //   renderResultsTable: true,
  //   renderLatencyTable: true
  // })
  // // console.log(result)
  // await stop()
} catch (error) {
  console.error(error)
  if (proxyProc) { proxyProc.kill(1) }
}

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
      console.error('Uncaught exception', err)
      gracefulExitHandler('Uncaught exception', 'Uncaught exception', 'Uncaught exception')
    })
    process.on('unhandledRejection', function unhandledRejectionHandler (reason, promise) {
      console.error('Unhandled rejection', reason, promise)
      gracefulExitHandler('Unhandled rejection', 'Unhandled rejection', 'Unhandled rejection')
    })
  } catch (err) {
    console.error('Unexpected error registering system events handlers', err)
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
      console.debug('Received exit signal', exitMessage)
      console.info('Graceful exit started')
      setTimeout(async () => {
        process.exitCode = 0
        process.exit()
      }, GRACEFUL_EXIT_DELAY)
      if (proxyProc) { proxyProc.kill(0) }
    } else { // Timeout has already been set (multiple end signals)
      console.debug('Received exit signal', exitMessage)
    }
  } catch (err) {
    console.error('Unexpected error handling graceful exit', err)
  }
}
