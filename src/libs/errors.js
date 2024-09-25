import { logger } from './logger.js'

export class ProxyError extends Error {
  /**
   * @param {string} message - The error message
   * @param {ProxyErrorCause} [options] - The error options
   */
  constructor (message, options) {
    super(message, options)
    this.name = this.constructor.name
    logger.error({ cause: options?.cause }, message)
  }
}

/** @type {ErrorOptions} */
export class ProxyErrorCause {
  /**
   * @param {string} title - The error human-readable title for end-users
   * @param {object} [metadata] - The error metadata with useful info about the method that failed, its parameters...
   * @param {Error|unknown} [innerError] - The inner error
   */
  constructor (title, metadata, innerError) {
    this.cause = {
      title,
      metadata,
      innerError
    }
  }
}
