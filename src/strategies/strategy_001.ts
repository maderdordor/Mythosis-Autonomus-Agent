import type { Strategy, StrategyParams, StrategyInputData, ParamSearchSpace } from './interface.js'
import type { Signal, OHLCV } from '../utils/types.js'
import { ema, rsi, atr, sma } from '../indicators/index.js'
import { registerStrategy } from './interface.js'

const edgeThesis = `
# Strategy 001: Funding Rate Extreme Reversal

**Edge Thesis**:
Perpetual futures contracts use a funding rate mechanism to anchor the perpetual price to the spot price. 
When longs are dominant, funding rate becomes positive. When shorts dominate, funding goes negative.
At funding rate extremes (above ~0.1% per 8h or below -0.1%), structural forces converge to create a mean-reversion opportunity:
1. Forced position closure: Retail traders face compounding costs, forcing exits.
2. Contrarian smart money: Sophisticated traders accumulate the opposite side to collect funding.
3. Self-reinforcing correction: Liquidations and closures push price toward reversal.

**Counterparty**: Retail leveraged momentum traders who chase momentum into an already-extended move.
**Why it persists**: Recency bias and FOMO. Funding mechanics are often invisible to retail.
**Our Advantage**: Targeting mid-cap perps ($500M-$5B) like SOLUSDT where high-frequency arbitrage is less saturated than BTC/ETH.
`

export class Strategy001 implements Strategy {
  readonly id = '001_funding_rate_reversal'
  readonly name = 'Funding Rate Extreme Reversal'
  readonly version = '0.1.0'
  readonly edgeThesis = edgeThesis.trim()

  readonly symbols = ['SOLUSDT']
  readonly primaryTimeframe = '1h'
  readonly marketType = 'perp'

  readonly requiredIndicators = ['ema', 'rsi', 'atr', 'vol_ma']
  readonly requiredDataFields = ['fundingRates']
  readonly marketRegimeAssumption = 'Non-trending or weakly-trending; funding extremes represent crowding, not genuine momentum.'
  readonly knownWeaknesses = [
    'Funding can stay extreme in genuine trend',
    '8h resolution funding data causes lag',
    'Network outage risk (SOL specific)',
  ]

  readonly paramSearchSpace: ParamSearchSpace = {
    funding_threshold: { min: 0.0005, max: 0.0015, step: 0.0001, description: 'Funding rate extreme threshold (e.g., 0.001 = 0.1%)' },
    funding_persistence_intervals: { min: 1, max: 4, step: 1, description: 'Consecutive intervals funding must be extreme' },
    ema_period: { min: 15, max: 30, step: 5, description: 'Trend indicator period' },
    rsi_period: { min: 10, max: 21, step: 1, description: 'Momentum indicator period' },
    rsi_threshold_long: { min: 35, max: 50, step: 5, description: 'RSI threshold for long entry' },
    rsi_threshold_short: { min: 50, max: 65, step: 5, description: 'RSI threshold for short entry' },
    atr_sl_multiplier: { min: 1.0, max: 2.5, step: 0.25, description: 'Multiplier for ATR-based stop loss' },
  }

  getDefaultParams(): StrategyParams {
    return {
      funding_threshold: 0.001,
      funding_persistence_intervals: 2,
      ema_period: 20,
      rsi_period: 14,
      rsi_threshold_long: 45,
      rsi_threshold_short: 55,
      atr_sl_multiplier: 1.5,
      max_risk_pct: 0.005,
    }
  }

  validateParams(params: StrategyParams): { valid: boolean; errors: string[] } {
    const errors: string[] = []
    
    for (const [key, range] of Object.entries(this.paramSearchSpace)) {
      if (!(key in params)) {
        errors.push(`Missing param: ${key}`)
        continue
      }
      const val = params[key] as number
      if (val < range.min || val > range.max) {
        errors.push(`${key} must be between ${range.min} and ${range.max}`)
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    }
  }

  generateSignals(data: StrategyInputData, params: StrategyParams): Signal[] {
    const { candles1h, fundingRates } = data
    if (!fundingRates || fundingRates.length === 0) {
      throw new Error('Strategy001 requires fundingRates')
    }

    const p = { ...this.getDefaultParams(), ...params }
    
    // In Mythos, TS generates signals for live trading/orchestration.
    // Python engine handles vectorized backtesting.
    // For live, we only need to evaluate the most recent state.
    
    // Compute indicators
    const closes = candles1h.map(c => c.close)
    const highs = candles1h.map(c => c.high)
    const lows = candles1h.map(c => c.low)
    const vols = candles1h.map(c => c.volume)

    const emaVals = ema(closes, p.ema_period as number)
    const rsiVals = rsi(closes, p.rsi_period as number)
    const atrVals = atr(highs, lows, closes, 14)
    const volMaVals = sma(vols, 20)

    const signals: Signal[] = []
    
    // Basic iterative signal generation (equivalent to python logic)
    for (let i = Math.max(p.ema_period as number, 20); i < candles1h.length; i++) {
      const candle = candles1h[i]
      const ts = candle.timestamp.getTime()
      
      // Find latest funding rate before this candle
      let currentFunding = 0
      for (let j = fundingRates.length - 1; j >= 0; j--) {
        if (fundingRates[j].timestamp.getTime() <= ts) {
          currentFunding = fundingRates[j].fundingRate
          break
        }
      }

      // Very simplified persistence check for TS side
      // Python handles the rigorous lookback
      const isExtremeNeg = currentFunding <= -(p.funding_threshold as number)
      const isExtremePos = currentFunding >= (p.funding_threshold as number)

      const close = closes[i]
      const emaVal = emaVals[i]
      const rsiVal = rsiVals[i]
      const volMaVal = volMaVals[i]
      const atrVal = atrVals[i]
      
      let signalAction: 'long' | 'short' | 'flat' = 'flat'
      
      if (
        isExtremeNeg && 
        close < emaVal && 
        rsiVal < (p.rsi_threshold_long as number) && 
        vols[i] >= volMaVal
      ) {
        signalAction = 'long'
      } else if (
        isExtremePos && 
        close > emaVal && 
        rsiVal > (p.rsi_threshold_short as number) && 
        vols[i] >= volMaVal
      ) {
        signalAction = 'short'
      }

      if (signalAction !== 'flat') {
        const slDist = Math.min((atrVal * (p.atr_sl_multiplier as number)) / close, 0.02)
        const slPrice = signalAction === 'long' ? close * (1 - slDist) : close * (1 + slDist)
        const tpPrice = signalAction === 'long' ? close * (1 + slDist * 1.8) : close * (1 - slDist * 1.8)

        signals.push({
          strategyId: this.id,
          symbol: candle.symbol,
          action: signalAction,
          timestamp: candle.timestamp,
          suggestedPrice: close,
          stopLoss: slPrice,
          takeProfit: tpPrice,
          positionSizePct: p.max_risk_pct as number,
          reason: 'Funding extreme reversion',
          metadata: {
            fundingRate: currentFunding,
            rsi: rsiVal,
            ema: emaVal,
            atr: atrVal
          }
        })
      }
    }

    return signals
  }
}

// Auto-register
registerStrategy(new Strategy001())
