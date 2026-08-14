import { createLogger } from '../utils/logger.js'
import { executePaperTrade, closePosition, openPositions } from '../execution/OrderExecutor.js'
import { config } from '../config/index.js'
import { fetchOrderBook, bybitClient } from '../data/bybitClient.js'
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
      const strat = getStrategy('f8a14b53-99b8-472e-8d59-3d19eb9c882a')
      const targetSymbols = strat.symbols && strat.symbols.length > 0 ? strat.symbols : ['SOLUSDT']

      // 1. Evaluate open positions for TP / SL
      for (const [symbol, position] of openPositions.entries()) {
        try {
          const ticker = await bybitClient.fetchTicker(symbol).catch(() => ({ last: position.entryPrice, close: position.entryPrice }));
          const currentPrice = ticker.last || ticker.close || position.entryPrice;
          
          if (currentPrice > 0 && currentPrice !== position.entryPrice) {
            const pnlPct = position.side === 'LONG' 
              ? (currentPrice - position.entryPrice) / position.entryPrice 
              : (position.entryPrice - currentPrice) / position.entryPrice;
              
            // Hardcoded basic risk management: 2% TP, 1% SL
            if (pnlPct >= 0.02) {
              log.info({ symbol, pnlPct: (pnlPct * 100).toFixed(2) + '%' }, 'Take Profit hit!');
              await closePosition(symbol, currentPrice, 'take_profit');
            } else if (pnlPct <= -0.01) {
              log.info({ symbol, pnlPct: (pnlPct * 100).toFixed(2) + '%' }, 'Stop Loss hit!');
              await closePosition(symbol, currentPrice, 'stop_loss');
            }
          }
        } catch (err) {
          log.error({ err, symbol }, 'Error evaluating TP/SL');
        }
      }

      // 2. Generate new signals
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
