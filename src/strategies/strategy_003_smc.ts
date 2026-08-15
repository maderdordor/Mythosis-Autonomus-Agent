import type { Strategy, StrategyParams, StrategyInputData, ParamSearchSpace } from './interface.js'
import type { Signal, OHLCV } from '../utils/types.js'
import { registerStrategy } from './interface.js'

const edgeThesis = `
# Strategy 003: SMC Order Block Sniper

**Edge Thesis**:
Markets are driven by institutional liquidity. Large institutions leave footprints in the form of "Order Blocks" 
(the last opposite candle before an impulsive move). This strategy identifies these 15m Order Blocks (OBs) 
and waits patiently for the price to return to this zone to pick up remaining liquidity.
Once inside the zone, the strategy scans the Level 2 Order Book to find the largest resting limit order (the "Wall").
It then front-runs this wall by placing a limit order 1 tick ahead of it, using the massive wall as a tight protective Stop Loss.
This hybrid approach yields extremely high Risk:Reward ratios by combining SMC precision with L2 micro-structure.
`

export class Strategy003 implements Strategy {
  readonly id = '1b9e2a44-66c5-4b5a-9a91-4c6e8e89f8d1'
  readonly name = 'SMC Order Block Sniper'
  readonly version = '0.1.0'
  readonly edgeThesis = edgeThesis.trim()

  readonly symbols = ['SOLUSDT', 'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT']
  readonly primaryTimeframe = '15m'
  readonly marketType = 'perp'

  readonly requiredIndicators = []
  readonly requiredDataFields = ['orderBook', 'candles15m']
  readonly marketRegimeAssumption = 'Ranging or retracement within a trend. Requires impulsive moves to form OBs.'
  readonly knownWeaknesses = [
    'Spoofing walls can cause premature stop-outs if the wall is pulled.',
    'Missed trades if price barely misses the wall before reversing.',
    'Infrequent signals due to strict sniper criteria.'
  ]

  readonly paramSearchSpace: ParamSearchSpace = {
    ob_lookback: { min: 20, max: 100, step: 10, description: 'Candles to look back for Order Blocks' },
    min_impulse_atr: { min: 1.5, max: 3.0, step: 0.5, description: 'Minimum size of move to validate an OB' },
  }

  getDefaultParams(): StrategyParams {
    return {
      ob_lookback: 50,
      min_impulse_atr: 2.0
    }
  }

  validateParams(params: StrategyParams): { valid: boolean; errors: string[] } {
    return { valid: true, errors: [] }
  }

  generateSignals(data: StrategyInputData, params: StrategyParams): Signal[] {
    const { orderBook, symbol } = data
    // Use candles1h property temporarily as generic input for OHLCV in the orchestrator 
    // (StrategyInputData has candles1h & candles4h, we use candles1h to hold 15m candles to avoid modifying interface too much)
    const candles = data.candles1h 

    if (!orderBook || !orderBook.bids || !orderBook.asks || !candles || candles.length < 10) {
      return []
    }
    const currentSymbol: string = symbol || this.symbols[0] || 'SOLUSDT'
    
    // 1. Identify Order Blocks (Simplified SMC Logic for MVP)
    let bullishOB: { top: number, bottom: number } | null = null;
    let bearishOB: { top: number, bottom: number } | null = null;
    
    // Calculate simple average candle size (ATR approximation)
    let avgBodySize = 0;
    for (let i = candles.length - 10; i < candles.length; i++) {
      avgBodySize += Math.abs(candles[i]!.close - candles[i]!.open);
    }
    avgBodySize /= 10;
    
    for (let i = candles.length - 2; i > Math.max(0, candles.length - 50); i--) {
      const current = candles[i];
      const prev = candles[i-1];
      
      if (!current || !prev) continue;
      
      const currentBody = current.close - current.open;
      const prevBody = prev.close - prev.open;
      
      // Found an impulsive move UP (Bullish OB is the down candle before it)
      if (currentBody > avgBodySize * 1.5 && prevBody < 0 && !bullishOB) {
        bullishOB = { top: prev.high, bottom: prev.low };
      }
      
      // Found an impulsive move DOWN (Bearish OB is the up candle before it)
      if (currentBody < -avgBodySize * 1.5 && prevBody > 0 && !bearishOB) {
        bearishOB = { top: prev.high, bottom: prev.low };
      }
      
      if (bullishOB && bearishOB) break;
    }
    
    const currentPrice = candles[candles.length - 1]!.close;
    const signals: Signal[] = [];
    
    // 2. Sniper Execution Logic via Order Book
    
    if (bullishOB && currentPrice <= bullishOB.top * 1.002 && currentPrice >= bullishOB.bottom * 0.998) {
      let biggestBid = orderBook.bids[0];
      for (let i = 1; i < Math.min(20, orderBook.bids.length); i++) {
        if (orderBook.bids[i][1] > biggestBid[1]) biggestBid = orderBook.bids[i];
      }
      const wallPrice = biggestBid[0];
      const wallVol = biggestBid[1];
      
      if (wallPrice >= bullishOB.bottom * 0.99) {
        const entryPrice = wallPrice + (wallPrice * 0.0001); 
        const stopLoss = wallPrice - (wallPrice * 0.001); 
        
        signals.push({
          strategyId: this.id,
          symbol: currentSymbol,
          side: 'long',
          strength: 'strong',
          timestamp: new Date(),
          entryPrice: entryPrice,
          stopLossPrice: stopLoss,
          takeProfitPrice: entryPrice * 1.03,
          positionSizePct: 0.05,
          riskPct: 0.005,
          rRatio: 3.0,
          reasons: [`SMC Bullish OB Retest. Found ${wallVol.toFixed(1)} qty wall at ${wallPrice}. Front-running at ${entryPrice.toFixed(4)}`],
          indicators: { wallPrice, wallVol }
        });
      }
    }
    
    if (bearishOB && currentPrice >= bearishOB.bottom * 0.998 && currentPrice <= bearishOB.top * 1.002) {
      let biggestAsk = orderBook.asks[0];
      for (let i = 1; i < Math.min(20, orderBook.asks.length); i++) {
        if (orderBook.asks[i][1] > biggestAsk[1]) biggestAsk = orderBook.asks[i];
      }
      const wallPrice = biggestAsk[0];
      const wallVol = biggestAsk[1];
      
      if (wallPrice <= bearishOB.top * 1.01) {
        const entryPrice = wallPrice - (wallPrice * 0.0001); 
        const stopLoss = wallPrice + (wallPrice * 0.001);
        
        signals.push({
          strategyId: this.id,
          symbol: currentSymbol,
          side: 'short',
          strength: 'strong',
          timestamp: new Date(),
          entryPrice: entryPrice,
          stopLossPrice: stopLoss,
          takeProfitPrice: entryPrice * 0.97,
          positionSizePct: 0.05,
          riskPct: 0.005,
          rRatio: 3.0,
          reasons: [`SMC Bearish OB Retest. Found ${wallVol.toFixed(1)} qty wall at ${wallPrice}. Front-running at ${entryPrice.toFixed(4)}`],
          indicators: { wallPrice, wallVol }
        });
      }
    }

    return signals
  }
}

// Auto-register
registerStrategy(new Strategy003())
