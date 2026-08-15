import { createLogger } from '../utils/logger.js'
import { executePaperTrade, closePosition, openPositions } from '../execution/OrderExecutor.js'
import { config } from '../config/index.js'
import { fetchOrderBook, bybitClient, fetchLiveOHLCV } from '../data/bybitClient.js'
import { getStrategy } from '../strategies/interface.js'
import '../strategies/strategy_003_smc.js'

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
      // For MVP, we hardcode Strategy 003 SMC Order Block Sniper
      const stratId = '1b9e2a44-66c5-4b5a-9a91-4c6e8e89f8d1' // Strategy 003 ID
      const strat = getStrategy(stratId)
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
              
            // Update max favorable price
            if (position.side === 'LONG' && currentPrice > position.maxFavorablePrice) {
              position.maxFavorablePrice = currentPrice;
            } else if (position.side === 'SHORT' && currentPrice < position.maxFavorablePrice) {
              position.maxFavorablePrice = currentPrice;
            }

            const maxFavorablePct = position.side === 'LONG'
              ? (position.maxFavorablePrice - position.entryPrice) / position.entryPrice
              : (position.entryPrice - position.maxFavorablePrice) / position.entryPrice;

            // Trailing Stop Logic:
            // 1. Hard Stop Loss at 1.5%
            // 2. If profit reached 1%, start trailing by 0.5% from max favorable price
            // 3. Hard Take Profit at 3%
            
            let shouldClose = false;
            let reason: 'take_profit' | 'stop_loss' | 'strategy_reversal' = 'stop_loss';

            if (pnlPct <= -0.015) {
              shouldClose = true;
              reason = 'stop_loss';
              log.info({ symbol, pnlPct: (pnlPct * 100).toFixed(2) + '%' }, 'Hard Stop Loss hit!');
            } else if (pnlPct >= 0.03) {
              shouldClose = true;
              reason = 'take_profit';
              log.info({ symbol, pnlPct: (pnlPct * 100).toFixed(2) + '%' }, 'Hard Take Profit hit!');
            } else if (maxFavorablePct >= 0.01) {
              // Trailing Stop activation
              const trailingStopPct = maxFavorablePct - 0.005; // Trail by 0.5%
              if (pnlPct <= trailingStopPct) {
                shouldClose = true;
                reason = 'take_profit';
                log.info({ symbol, pnlPct: (pnlPct * 100).toFixed(2) + '%', trailingStopPct: (trailingStopPct * 100).toFixed(2) + '%' }, 'Trailing Stop hit!');
              }
            }

            if (shouldClose) {
              await closePosition(symbol, currentPrice, reason);
            }
          }
        } catch (err) {
          log.error({ err, symbol }, 'Error evaluating TP/SL');
        }
      }

      // 2. Generate new signals
      for (const symbol of targetSymbols) {
        try {
          // Fetch order book for micro-structure
          const orderBook = await fetchOrderBook(symbol, 20)
          
          // Fetch 15m candles for SMC Order Block detection
          const candles15m = await fetchLiveOHLCV(symbol, '15m', 50)
          
          // Pass candles to the strategy via candles1h property (as temporary generic holder)
          const signals = strat.generateSignals({ orderBook, symbol, candles1h: candles15m }, strat.getDefaultParams())
          
          if (signals && signals.length > 0) {
            const sig = signals[signals.length - 1]
            if (!sig) continue
            
            log.info({ symbol, side: sig.side, price: sig.entryPrice, reason: sig.reasons.join(', ') }, 'SMC Sniper Strategy generated signal! Executing.')
            
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
