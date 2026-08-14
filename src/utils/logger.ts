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
  const child = logger.child({ module })
  
  const wrap = (level: string, originalFn: Function) => {
    return (obj: unknown, msg?: string, ...args: any[]) => {
      // Execute original Pino logger first so terminal gets the log immediately
      originalFn(obj, msg, ...args)
      
      try {
        let payload = {}
        let message = ''
        
        if (typeof obj === 'string') {
          message = obj
        } else {
          payload = obj || {}
          message = msg || ''
        }
        
        // Redact sensitive info
        const safePayload = sanitizePayload(payload)
        
        // Lazy load supabase to avoid circular dependency
        const insertLog = (sb: any) => {
          sb.from('system_logs').insert({
            level,
            module,
            message,
            details: Object.keys(safePayload).length > 0 ? safePayload : null
          }).then((res: any) => {
            if (res.error && level !== 'error' && module !== 'logger') {
              child.error({ error: res.error.message }, 'Failed to insert system_log to Supabase')
            }
          })
        }

        import('../storage/supabaseClient.js').then(mod => {
          if (mod.supabase) {
            insertLog(mod.supabase)
          }
        }).catch(() => {})
        
      } catch (err) {
        // Safe catch, do not crash application if logging fails
      }
    }
  }
  
  // Override the log methods on the child instance
  child.info = wrap('info', child.info.bind(child))
  child.warn = wrap('warn', child.warn.bind(child))
  child.error = wrap('error', child.error.bind(child))
  
  return child
}

/**
 * Recursively removes sensitive properties from an object
 */
function sanitizePayload(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj
  
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizePayload(item))
  }
  
  const result: any = {}
  const sensitivePatterns = [/key/i, /secret/i, /token/i, /pass/i, /credential/i]
  
  for (const [key, value] of Object.entries(obj)) {
    if (sensitivePatterns.some(pattern => pattern.test(key))) {
      result[key] = '[REDACTED]'
    } else if (typeof value === 'object') {
      result[key] = sanitizePayload(value)
    } else {
      result[key] = value
    }
  }
  
  return result
}
