import type { Strategy, StrategyParams, StrategyInputData, ParamSearchSpace } from './interface.js'
import type { Signal } from '../utils/types.js'
import { registerStrategy } from './interface.js'

const edgeThesis = `
# Strategy 002: Order Book Imbalance (OBI) Scalper

**Edge Thesis**:
Order books in highly liquid perpetual futures often show short-term directional pressure before price moves.
By measuring the volumetric imbalance between the top 20 levels of bids and asks, we can predict micro-trends.
If Bids heavily outweigh Asks (e.g., >70% ratio), it indicates strong buy wall pressure.
The bot automatically places a Limit Order at the Best Bid to act as a Maker, capturing the spread without paying Taker fees.
This is a high-frequency style strategy suitable for fast, algorithmic execution.
`

export class Strategy002 implements Strategy {
  readonly id = 'f8a14b53-99b8-472e-8d59-3d19eb9c882a'
  readonly name = 'Order Book Imbalance Limit Scalper'
  readonly version = '0.1.0'
  readonly edgeThesis = edgeThesis.trim()

  readonly symbols = ['SOLUSDT', 'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT']
  readonly primaryTimeframe = '1m'
  readonly marketType = 'perp'

  readonly requiredIndicators = []
  readonly requiredDataFields = ['orderBook']
  readonly marketRegimeAssumption = 'Any regime; relies on micro-structure liquidity.'
  readonly knownWeaknesses = [
    'Spoofing orders can fake imbalance',
    'High latency can cause missed fills'
  ]

  readonly paramSearchSpace: ParamSearchSpace = {
    imbalance_threshold: { min: 0.6, max: 0.9, step: 0.05, description: 'Ratio of Bid/Ask volume to trigger signal' },
    depth_levels: { min: 5, max: 50, step: 5, description: 'Number of order book levels to consider' },
  }

  getDefaultParams(): StrategyParams {
    return {
      imbalance_threshold: 0.70, // 70%
      depth_levels: 20
    }
  }

  validateParams(params: StrategyParams): { valid: boolean; errors: string[] } {
    return { valid: true, errors: [] } // Simplify for MVP
  }

  generateSignals(data: StrategyInputData, params: StrategyParams): Signal[] {
    const { orderBook, symbol } = data
    if (!orderBook || !orderBook.bids || !orderBook.asks) {
      return []
    }
    const currentSymbol: string = symbol || this.symbols[0] || 'SOLUSDT'

    const p = { ...this.getDefaultParams(), ...params }
    const threshold = p.imbalance_threshold as number
    const depth = p.depth_levels as number

    // Calculate Bid Volume
    let bidVol = 0
    let bestBid = orderBook.bids[0]?.[0] || 0
    for (let i = 0; i < Math.min(depth, orderBook.bids.length); i++) {
      bidVol += orderBook.bids[i][1]
    }

    // Calculate Ask Volume
    let askVol = 0
    let bestAsk = orderBook.asks[0]?.[0] || 0
    for (let i = 0; i < Math.min(depth, orderBook.asks.length); i++) {
      askVol += orderBook.asks[i][1]
    }

    const totalVol = bidVol + askVol
    if (totalVol === 0) return []

    const bidRatio = bidVol / totalVol
    const askRatio = askVol / totalVol

    const signals: Signal[] = []
    
    // Create signal
    if (bidRatio >= threshold) {
      // Strong buy pressure -> Place Limit Buy at Best Bid
      signals.push({
        strategyId: this.id,
        symbol: currentSymbol,
        side: 'long',
        strength: 'strong',
        timestamp: new Date(),
        entryPrice: bestBid,
        stopLossPrice: bestBid * 0.99,
        takeProfitPrice: bestBid * 1.01,
        positionSizePct: 0.05,
        riskPct: 0.005,
        rRatio: 1.0,
        reasons: [`OBI Buy Pressure: ${(bidRatio*100).toFixed(1)}%`],
        indicators: { bidRatio, askRatio }
      })
    } else if (askRatio >= threshold) {
      // Strong sell pressure -> Place Limit Sell at Best Ask
      signals.push({
        strategyId: this.id,
        symbol: currentSymbol,
        side: 'short',
        strength: 'strong',
        timestamp: new Date(),
        entryPrice: bestAsk,
        stopLossPrice: bestAsk * 1.01,
        takeProfitPrice: bestAsk * 0.99,
        positionSizePct: 0.05,
        riskPct: 0.005,
        rRatio: 1.0,
        reasons: [`OBI Sell Pressure: ${(askRatio*100).toFixed(1)}%`],
        indicators: { bidRatio, askRatio }
      })
    }

    return signals
  }
}

// Auto-register
registerStrategy(new Strategy002())
