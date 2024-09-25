import { env } from 'bun'
import Pino from 'pino'

/** @type {Pino.LevelWithSilentOrString} */
export const logLevel = env.MAEGASHIRA_LOG_LEVEL || 'info'

/** @type {Pino.LoggerOptions} */
const loggerOptions = {
  level: logLevel
}
if (logLevel === 'debug') {
  loggerOptions.transport = {
    target: 'pino-pretty',
    options: {
      colorize: true
    }
  }
  // Logs fetch operations request and response
  // See: https://bun.sh/docs/runtime/debugger
  env.BUN_CONFIG_VERBOSE_FETCH = 'true'
}
export const logger = Pino.default(loggerOptions)
