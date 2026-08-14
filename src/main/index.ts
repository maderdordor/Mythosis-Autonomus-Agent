import { createLogger } from '../utils/logger.js'
import { config } from '../config/index.js'
import { testConnection as testSupabase } from '../storage/supabaseClient.js'
import { BotOrchestrator } from '../live_trading/BotOrchestrator.js'

const log = createLogger('main')

async function bootstrap() {
  log.info('=============================================')
  log.info('   MYTHOS TRADING AGENT - INITIALIZING       ')
  log.info('=============================================')
  log.info({ 
    phase: 0,
    testnet: config.BYBIT_TESTNET,
    liveTrading: config.LIVE_TRADING,
    executionMode: config.EXECUTION_MODE 
  }, 'Configuration loaded')

  try {
    // 1. Test database connection
    log.info('Testing Supabase connection...')
    await testSupabase()

    // 2. Start the core orchestrator
    const orchestrator = new BotOrchestrator()
    
    // Handle graceful shutdown
    const shutdown = () => {
      log.info('Received shutdown signal. Stopping orchestrator...')
      orchestrator.stop()
      setTimeout(() => process.exit(0), 1000)
    }

    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)

    await orchestrator.start()

  } catch (error) {
    log.fatal({ error }, 'Fatal error during bootstrap')
    process.exit(1)
  }
}

bootstrap()
