import { Queue } from 'bullmq'
import { Redis } from 'ioredis'
import { logger } from './logger.js'
import { ProxyError, ProxyErrorCause } from './errors.js'

const LOG_PREFIX = 'Worker:'
/** @type {import('ioredis').Redis} */
let redisConnection
/** @type {import('bullmq').Queue} */
let postTransactionQueue
const postTransactionQueueName = 'post-transaction'

/**
 * @typedef {object} RedisConnectionOptions
 * @property {string} host - Redis host
 * @property {number} port - Redis port
 * @property {number} [databaseIndex] - Redis database index (default: 0)
 * @property {boolean} [tls] - Use TLS for the Redis connection (default: false)
 * @property {string} [password] - Redis password (default: "")
 */

/**
 * @function initializeQueues
 * @description Initialize the queues
 * @param {RedisConnectionOptions} options - The Redis connection options
 * @returns {import('ioredis').Redis} - The Redis connection
 * @throws {QueuesError} - Throws an error if the queues could not be started
 */
export function initializeQueues ({
  host = 'localhost',
  port = 6379,
  databaseIndex = 0,
  tls = false,
  password = ''
}) {
  try {
    // Create Redis connection
    const redisProtocol = tls === true ? 'rediss' : 'redis'
    const redisUrl = `${redisProtocol}://:${password}@${host}:${port}/${databaseIndex}`
    redisConnection = new Redis(redisUrl, {
      retryStrategy: redisConnectionRetryStrategy,
      maxRetriesPerRequest: null
    })

    startQueues()

    return redisConnection
  } catch (error) {
    logger.error(error, `${LOG_PREFIX} Error initializing queues`)
    throw new QueuesError('Error initializing queues',
      new ProxyErrorCause('Error initializing queues', {
        host,
        port,
        databaseIndex,
        tls,
        password
      }, error)
    )
  }
}

/**
 * @function startQueues
 * @description Start the queues
 * @returns {boolean} - True if the queues started successfully
 * @throws {QueuesError} - Throws an error if the queues could not be started
 */
function startQueues () {
  try {
    // Create queues
    postTransactionQueue = new Queue(postTransactionQueueName, {
      connection: redisConnection
      // Define prefix for all queue keys
      // prefix: `${redisKeysPrefix}queues`
      // Set rate limiter
      // limiter: { // Rate Limiter
      //   max: 10, // Max number of jobs processed
      //   duration: 1000, // per duration in milliseconds
      //   bounceBack: false // When jobs get rate limited, they stay in the waiting queue and are not moved to the delayed queue
      // },
    })
    return true
  } catch (error) {
    logger.error(error, `${LOG_PREFIX} Error starting queues`)
    throw new QueuesError('Error starting queues',
      new ProxyErrorCause('Error starting queues', {}, error)
    )
  }
}

export const queues = {
  postTransaction: postTransactionQueueName
}

/**
 * @function redisConnectionRetryStrategy
 * @description Retry strategy for the Redis client
 * @see {@link https://github.com/redis/ioredis#auto-reconnect}
 * @param {number} times - Number of reconnection being made
 * @returns {number} - Delay in milliseconds before trying to reconnect
 */
function redisConnectionRetryStrategy (times) {
  logger.warn(`${LOG_PREFIX} Redis client retry strategy: #${times}`)
  const minimumDelay = 1000
  const maximumDelay = 20000
  const delay = Math.max(Math.min(Math.exp(times), maximumDelay), minimumDelay)
  return delay
}

/**
 * @function CreatcreatePostTransactionJob
 * @description Create a new post transaction job
 * @param {object} options - The job options
 * @param {string} [options.id] - The job ID
 * @param {object} options.transaction - The job data
 * @returns {Promise<import('bullmq').Job>} - A promise that resolves when the job is added to the queue
 * @throws {QueuesError} - Throws an error if the job could not be added to the queue
 */
export async function createPostTransactionJob ({ id, transaction }) {
  try {
    const jobId = id || `${postTransactionQueueName}-${String(new Date().getTime())}}`
    /** @type {import('bullmq').JobsOptions} */
    const postTransactionJobOptions = {
      jobId,
      attempts: 1,
      backoff: {
        type: 'fixed',
        delay: 1000
      },
      removeOnComplete: false,
      removeOnFail: false,
      lifo: false,
      // In ms
      delay: 0,
      priority: 0
    }
    /** @type {import('bullmq').Job} */
    const postTransactionJob = await postTransactionQueue.add(jobId, transaction, postTransactionJobOptions)
    logger.debug(`${LOG_PREFIX} Job ${postTransactionJob.id} added to queue ${postTransactionQueueName}`)
    return postTransactionJob
  } catch (error) {
    logger.error(error, `${LOG_PREFIX} Error pushing post transaction job to the queue`)
    throw new QueuesError('Error pushing post transaction job to the queue',
      new ProxyErrorCause('Error pushing post transaction job to the queue', transaction, error)
    )
  }
}

/**
 * @function stopQueues
 * @description Stop the queues
 * @returns {Promise<boolean>} - True if the queues stopped successfully
 */
export async function stopQueues () {
  try {
    await postTransactionQueue.close()
    redisConnection.disconnect()
    return true
  } catch (error) {
    logger.error(error, `${LOG_PREFIX} Error stopping queues`)
    throw new QueuesError('Error stopping queues', new ProxyErrorCause('Error stopping queues', {}, error))
  }
}

class QueuesError extends ProxyError { }
