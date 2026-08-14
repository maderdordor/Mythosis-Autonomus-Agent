import { createLogger } from '../utils/logger.js'
import { executePaperTrade } from '../execution/OrderExecutor.js'
import { config } from '../config/index.js'
import { fetchOrderBook } from '../data/bybitClient.js'
import { getStrategy } from '../strategies/interface.js'
import '../strategies/strategy_002_obi.js'

const log = createLogger('live_trading:orchestrator')

export class BotOrchestrator {
  private isRunning = false
  private scanIntervalMs = 10000 // 10 seconds default

  constructor() {
    this.scanIntervalMs = 10 * 1000 
  }

  public async start() {
    if (this.isRunning) return
    this.isRunning = true

    log.info('Bot Orchestrator started. Scan interval: 10 seconds.')

    while (this.isRunning) {
      await this.scanCycle()
      await this.sleep(this.scanIntervalMs)
    }
  }

  public stop() {
    this.isRunning = false
    log.info('Bot Orchestrator stopped.')
  }

  private async scanCycle() {
    log.debug('--- Starting Scan Cycle ---')
    try {
      const strat = getStrategy('22222222-2222-2222-2222-222222222222')
      const targetSymbols = strat.symbols && strat.symbols.length > 0 ? strat.symbols : ['SOLUSDT']

      for (const symbol of targetSymbols) {
        try {
          const orderBook = await fetchOrderBook(symbol, 20)
          
          const signals = strat.generateSignals({ orderBook, symbol }, strat.getDefaultParams())
          
          if (signals && signals.length > 0) {
            const sig = signals[signals.length - 1]
            if (!sig) continue
            
            log.info({ symbol, side: sig.side, price: sig.entryPrice, reason: sig.reasons.join(', ') }, 'OBI Limit Strategy generated signal! Executing.')
            
            await executePaperTrade(symbol, sig.side === 'long' ? 'LONG' : 'SHORT', sig.entryPrice, strat.id, sig.positionSizePct || 0.05)
          } else {
            // log.debug({ symbol }, 'No OBI signal generated this cycle.')
          }
        } catch (err) {
          log.error({ err, symbol }, 'Error processing symbol during scan cycle')
        }
      }
      
    } catch (err) {
      log.error({ err }, 'Error during scan cycle')
    }
  }

  private sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
