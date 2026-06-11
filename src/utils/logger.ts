import pino from 'pino'
import { config } from '../config/index.js'

const isDev = config.LOG_FORMAT === 'pretty'

export const logger = pino({
  level: config.LOG_LEVEL,
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
      }
    : {
        // Production: structured JSON for log aggregators
        formatters: {
          level: (label: string) => ({ level: label }),
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      }),
})

/**
 * Create a child logger with a fixed context label.
 * Use this in every module for structured log context.
 *
 * @example
 * const log = createLogger('data:bybit')
 * log.info({ symbol: 'SOLUSDT' }, 'Fetching OHLCV')
 */
export function createLogger(module: string) {
  return logger.child({ module })
}
