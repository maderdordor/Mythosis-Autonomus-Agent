/**
 * Technical Indicators Library
 * Pure functions — no side effects, no external calls, deterministic.
 * All indicators take a number array and return a number array.
 * Insufficient data returns null for that index position.
 */

// ============================================================================
// EMA — Exponential Moving Average
// ============================================================================

export function ema(values: number[], period: number): (number | null)[] {
  if (values.length < period) return values.map(() => null)

  const k = 2 / (period + 1)
  const result: (number | null)[] = new Array(period - 1).fill(null)

  // Seed with SMA of first `period` values
  const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period
  result.push(seed)

  for (let i = period; i < values.length; i++) {
    const prev = result[result.length - 1] as number
    result.push((values[i]! * k) + (prev * (1 - k)))
  }

  return result
}

// ============================================================================
// SMA — Simple Moving Average
// ============================================================================

export function sma(values: number[], period: number): (number | null)[] {
  return values.map((_, i) => {
    if (i < period - 1) return null
    const slice = values.slice(i - period + 1, i + 1)
    return slice.reduce((a, b) => a + b, 0) / period
  })
}

// ============================================================================
// RSI — Relative Strength Index
// ============================================================================

export function rsi(values: number[], period: number = 14): (number | null)[] {
  if (values.length < period + 1) return values.map(() => null)

  const result: (number | null)[] = []

  let avgGain = 0
  let avgLoss = 0

  // Initial averages over first `period` changes
  for (let i = 1; i <= period; i++) {
    const change = (values[i] ?? 0) - (values[i - 1] ?? 0)
    if (change > 0) avgGain += change
    else avgLoss += Math.abs(change)
  }

  avgGain /= period
  avgLoss /= period

  // Fill nulls for the first `period` indices
  for (let i = 0; i < period; i++) result.push(null)

  const firstRsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss))
  result.push(firstRsi)

  // Wilder's smoothing
  for (let i = period + 1; i < values.length; i++) {
    const change = (values[i] ?? 0) - (values[i - 1] ?? 0)
    const gain = change > 0 ? change : 0
    const loss = change < 0 ? Math.abs(change) : 0

    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period

    const rsiValue = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss))
    result.push(rsiValue)
  }

  return result
}

// ============================================================================
// ATR — Average True Range
// ============================================================================

export function atr(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14
): (number | null)[] {
  if (highs.length < period + 1) return highs.map(() => null)

  const trueRanges: number[] = [null as unknown as number] // First TR is undefined

  for (let i = 1; i < highs.length; i++) {
    const hl = (highs[i] ?? 0) - (lows[i] ?? 0)
    const hc = Math.abs((highs[i] ?? 0) - (closes[i - 1] ?? 0))
    const lc = Math.abs((lows[i] ?? 0) - (closes[i - 1] ?? 0))
    trueRanges.push(Math.max(hl, hc, lc))
  }

  const result: (number | null)[] = [null]

  // Initial ATR = SMA of first `period` TRs
  let currentAtr = trueRanges.slice(1, period + 1).reduce((a, b) => a + b, 0) / period

  for (let i = 1; i <= period; i++) result.push(null)
  result.push(currentAtr)

  // Wilder's smoothing
  for (let i = period + 1; i < trueRanges.length; i++) {
    currentAtr = (currentAtr * (period - 1) + (trueRanges[i] ?? 0)) / period
    result.push(currentAtr)
  }

  return result
}

// ============================================================================
// Volume MA — Simple moving average of volume
// ============================================================================

export function volumeMA(volumes: number[], period: number = 20): (number | null)[] {
  return sma(volumes, period)
}

// ============================================================================
// Bollinger Bands
// ============================================================================

export interface BollingerBand {
  upper: number | null
  middle: number | null
  lower: number | null
  bandwidth: number | null
  percentB: number | null
}

export function bollingerBands(
  values: number[],
  period: number = 20,
  stdDevMultiplier: number = 2
): BollingerBand[] {
  return values.map((_, i) => {
    if (i < period - 1) {
      return { upper: null, middle: null, lower: null, bandwidth: null, percentB: null }
    }

    const slice = values.slice(i - period + 1, i + 1)
    const middle = slice.reduce((a, b) => a + b, 0) / period
    const variance = slice.reduce((a, b) => a + Math.pow(b - middle, 2), 0) / period
    const stdDev = Math.sqrt(variance)

    const upper = middle + stdDevMultiplier * stdDev
    const lower = middle - stdDevMultiplier * stdDev
    const bandwidth = upper - lower
    const currentValue = values[i] ?? 0
    const percentB = bandwidth > 0 ? (currentValue - lower) / bandwidth : 0.5

    return { upper, middle, lower, bandwidth, percentB }
  })
}

// ============================================================================
// VWAP — Volume Weighted Average Price
// Calculates cumulative VWAP from start of array (typically daily reset)
// ============================================================================

export function vwap(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[]
): (number | null)[] {
  let cumulativeTPV = 0   // Typical Price × Volume
  let cumulativeVol = 0

  return closes.map((_, i) => {
    const typicalPrice = ((highs[i] ?? 0) + (lows[i] ?? 0) + (closes[i] ?? 0)) / 3
    const vol = volumes[i] ?? 0

    cumulativeTPV += typicalPrice * vol
    cumulativeVol += vol

    return cumulativeVol > 0 ? cumulativeTPV / cumulativeVol : null
  })
}

// ============================================================================
// Utility: extract column from OHLCV array
// ============================================================================

import type { OHLCV } from '../utils/types.js'

export const extractClose   = (candles: OHLCV[]) => candles.map(c => c.close)
export const extractHigh    = (candles: OHLCV[]) => candles.map(c => c.high)
export const extractLow     = (candles: OHLCV[]) => candles.map(c => c.low)
export const extractOpen    = (candles: OHLCV[]) => candles.map(c => c.open)
export const extractVolume  = (candles: OHLCV[]) => candles.map(c => c.volume)

/**
 * Get the last non-null value from an indicator array.
 * Used to get "current" value for signal generation.
 */
export function lastValue(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] !== null) return arr[i]!
  }
  return null
}

/**
 * Get the last N non-null values from an indicator array.
 */
export function lastNValues(arr: (number | null)[], n: number): number[] {
  const result: number[] = []
  for (let i = arr.length - 1; i >= 0 && result.length < n; i--) {
    if (arr[i] !== null) result.unshift(arr[i]!)
  }
  return result
}
