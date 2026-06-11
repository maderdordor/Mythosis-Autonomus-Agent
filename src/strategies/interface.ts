import type { OHLCV, Signal, FundingRate, BacktestMetrics } from '../utils/types.js'

// ============================================================================
// Strategy interface — MANDATORY contract for every strategy
// Brief Section 8.2
// ============================================================================

export interface StrategyParams {
  [key: string]: number | string | boolean
}

export interface ParamRange {
  min: number
  max: number
  step: number
  description: string
}

export interface ParamSearchSpace {
  [paramName: string]: ParamRange
}

export interface StrategyInputData {
  candles1h: OHLCV[]
  candles4h?: OHLCV[]     // Optional trend filter timeframe
  fundingRates?: FundingRate[]  // Required for funding-based strategies
}

/**
 * The mandatory strategy interface.
 * Every strategy must implement all fields.
 * Validation on load rejects strategies with missing/empty edge thesis.
 */
export interface Strategy {
  // Identity
  readonly id: string         // Unique slug: 'strategy_001_funding_reversal'
  readonly name: string
  readonly version: string    // semver: '0.1.0'

  // MANDATORY edge thesis (Section 4.2) — cannot be empty
  readonly edgeThesis: string

  // Market config
  readonly symbols: string[]
  readonly primaryTimeframe: string
  readonly filterTimeframe?: string
  readonly marketType: 'spot' | 'perp'

  // Strategy spec
  readonly paramSearchSpace: ParamSearchSpace
  readonly requiredIndicators: string[]
  readonly requiredDataFields: string[]   // e.g. ['fundingRates', 'candles4h']
  readonly marketRegimeAssumption: string
  readonly knownWeaknesses: string[]

  // Methods
  generateSignals(data: StrategyInputData, params: StrategyParams): Signal[]
  validateParams(params: StrategyParams): { valid: boolean; errors: string[] }
  getDefaultParams(): StrategyParams
}

// ============================================================================
// Strategy registry — load and validate strategies
// ============================================================================

const registry = new Map<string, Strategy>()

/**
 * Register a strategy. Validates edge thesis before accepting.
 * Throws if edge thesis is empty or too short.
 */
export function registerStrategy(strategy: Strategy): void {
  // Enforce edge thesis requirement (Section 4.2)
  if (!strategy.edgeThesis || strategy.edgeThesis.trim().length < 100) {
    throw new Error(
      `Strategy "${strategy.id}" rejected: edgeThesis must be at least 100 characters. ` +
      `"It backtests well" is not an edge thesis. (Brief Section 4.2)`
    )
  }

  // Validate param search space is defined
  if (Object.keys(strategy.paramSearchSpace).length === 0) {
    throw new Error(`Strategy "${strategy.id}" rejected: paramSearchSpace cannot be empty`)
  }

  // Validate default params are within search space
  const defaults = strategy.getDefaultParams()
  const { valid, errors } = strategy.validateParams(defaults)
  if (!valid) {
    throw new Error(
      `Strategy "${strategy.id}" default params failed validation: ${errors.join(', ')}`
    )
  }

  registry.set(strategy.id, strategy)
}

export function getStrategy(id: string): Strategy {
  const s = registry.get(id)
  if (!s) throw new Error(`Strategy not found: ${id}`)
  return s
}

export function listStrategies(): Strategy[] {
  return Array.from(registry.values())
}

// ============================================================================
// Verdict type for strategy validation results
// ============================================================================

export interface StrategyValidationSummary {
  strategyId: string
  strategyName: string
  params: StrategyParams
  backtestMetrics?: BacktestMetrics
  wfoVerdict?: string
  mcVerdict?: string
  holdoutVerdict?: string
  overfitRisk?: string
  feeViabilityPass?: boolean
  finalVerdict?: string
  failedComponents?: string[]
  reasons?: string[]
}
