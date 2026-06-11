/**
 * Shared types used across all modules.
 * Keep this file focused on data shapes — no business logic here.
 */

// ============================================================================
// Market data
// ============================================================================

export type MarketType = 'spot' | 'perp'
export type Exchange = 'bybit' | 'binance' | 'okx'
export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d'

export interface OHLCV {
  timestamp: Date
  open: number
  high: number
  low: number
  close: number
  volume: number
  exchange: Exchange
  symbol: string
  timeframe: Timeframe
  marketType: MarketType
}

export interface FundingRate {
  timestamp: Date
  exchange: Exchange
  symbol: string
  fundingRate: number   // e.g. 0.0001 = 0.01% = 1 basis point
}

// ============================================================================
// Signals & decisions
// ============================================================================

export type SignalSide = 'long' | 'short'
export type SignalStrength = 'weak' | 'moderate' | 'strong'

export interface Signal {
  timestamp: Date
  strategyId: string
  symbol: string
  side: SignalSide
  strength: SignalStrength
  entryPrice: number
  stopLossPrice: number
  takeProfitPrice: number
  positionSizePct: number     // Fraction of equity (e.g. 0.1 = 10%)
  riskPct: number             // Risk as fraction of equity (e.g. 0.005 = 0.5%)
  rRatio: number              // Reward:Risk ratio
  indicators: Record<string, number>
  reasons: string[]
}

// ============================================================================
// Backtest
// ============================================================================

export interface BacktestTrade {
  id: string
  strategyId: string
  symbol: string
  side: SignalSide
  entryTime: Date
  exitTime: Date
  entryPrice: number
  exitPrice: number
  positionSize: number
  grossPnlUsd: number
  feesPaidUsd: number
  slippageCostUsd: number
  netPnlUsd: number
  netPnlPct: number
  rMultiple: number
  holdingBars: number
  exitReason: string
  stopLossPrice: number
  takeProfitPrice: number
  indicators: Record<string, number>
}

export interface BacktestMetrics {
  // Returns
  totalReturnPct: number
  netPnlUsd: number
  cagrPct: number

  // Risk
  maxDrawdownPct: number
  sharpeRatio: number
  sortinoRatio: number
  calmarRatio: number

  // Edge
  profitFactor: number
  winRatePct: number
  expectancyUsd: number
  avgWinUsd: number
  avgLossUsd: number

  // Trade stats
  bestTradeUsd: number
  worstTradeUsd: number
  totalTrades: number
  longTrades: number
  shortTrades: number
  maxConsecWins: number
  maxConsecLosses: number

  // Execution
  exposureTimePct: number
  avgHoldBars: number
  feesPaidUsd: number
  slippageCostUsd: number

  // Fee viability (Section 3.4)
  avgGrossEdgePct: number
  roundTripCostPct: number
  feeViabilityPass: boolean

  // Period
  dataStart: Date
  dataEnd: Date
  dataSegment: string
}

// ============================================================================
// Risk engine
// ============================================================================

export interface RiskCheckResult {
  allowed: boolean
  riskLevel: 'low' | 'medium' | 'high'
  reason: string
  adjustedPositionSize?: number   // If size was capped
}

export interface AccountState {
  equity: number
  dailyPnlPct: number
  weeklyPnlPct: number
  currentDrawdownPct: number
  openPositions: number
  lossStreak: number
  killSwitchActive: boolean
}

// ============================================================================
// Validation verdicts
// ============================================================================

export type Verdict = 'PASS' | 'MARGINAL' | 'FAIL'
export type OverfitRisk = 'LOW' | 'MEDIUM' | 'HIGH'

export interface ValidationResult {
  component: string
  verdict: Verdict
  reasons: string[]
  metrics?: Record<string, number | boolean | string>
}

export interface FinalVerdict {
  strategyId: string
  verdict: Verdict
  wfoVerdict: Verdict
  mcVerdict: Verdict
  holdoutVerdict: Verdict
  overfitRisk: OverfitRisk
  feeViabilityPass: boolean
  executionRealism: boolean
  riskPolicyPass: boolean
  failedComponents: string[]
  reasons: string[]
  improvementSuggestions: string[]
}
