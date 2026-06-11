import ccxt, { type bybit as BybitType, type FundingRateHistory } from 'ccxt'
import type { OHLCV as CcxtOHLCV } from 'ccxt'
import { supabase } from '../storage/supabaseClient.js'
import { createLogger } from '../utils/logger.js'
import { config } from '../config/index.js'
import type { OHLCV, FundingRate, Timeframe, MarketType } from '../utils/types.js'

const log = createLogger('data:bybit')

// ============================================================================
// Bybit client via ccxt
// Phase 0: uses public endpoints — no API key required for OHLCV
// Phase 2+: API key enables private endpoints for paper/live trading
// ============================================================================

function createBybitClient(): BybitType {
  const hasCredentials = config.BYBIT_API_KEY !== '' && config.BYBIT_API_SECRET !== ''

  const client = new ccxt.bybit({
    ...(hasCredentials
      ? {
          apiKey: config.BYBIT_API_KEY,
          secret: config.BYBIT_API_SECRET,
        }
      : {}),
    enableRateLimit: true,
    rateLimit: 500,  // ms between requests (Bybit: 120 req/min public = 500ms safe)
    options: {
      defaultType: 'swap',          // Default to perps
      adjustForTimeDifference: true,
    },
  })

  if (config.BYBIT_TESTNET) {
    client.setSandboxMode(true)
  }

  if (!hasCredentials) {
    log.info('Bybit client initialized in PUBLIC mode (no API key — Phase 0)')
  } else {
    log.info({ testnet: config.BYBIT_TESTNET }, 'Bybit client initialized with API credentials')
  }

  return client
}

export const bybitClient = createBybitClient()

// ============================================================================
// Timeframe utilities
// ============================================================================

const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1m':  60_000,
  '5m':  5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h':  60 * 60_000,
  '4h':  4 * 60 * 60_000,
  '1d':  24 * 60 * 60_000,
}

// ============================================================================
// Get latest timestamp already stored for a symbol/timeframe
// Used for incremental fetching (only new candles)
// ============================================================================

async function getLatestStoredTimestamp(
  symbol: string,
  timeframe: Timeframe,
  marketType: MarketType,
): Promise<Date | null> {
  const { data, error } = await supabase
    .from('ohlcv_candles')
    .select('timestamp')
    .eq('exchange', 'bybit')
    .eq('symbol', symbol)
    .eq('timeframe', timeframe)
    .eq('market_type', marketType)
    .order('timestamp', { ascending: false })
    .limit(1)

  if (error || !data || data.length === 0) return null
  const firstRow = data[0]
  if (!firstRow) return null
  return new Date(firstRow.timestamp as string)
}

// ============================================================================
// Fetch OHLCV from Bybit and upsert to Supabase
// ============================================================================

export interface FetchOptions {
  symbol: string
  timeframe: Timeframe
  marketType: MarketType
  since?: Date     // If not provided, fetches from a default lookback
  limit?: number   // Max candles per batch (Bybit: 1000)
}

export interface FetchResult {
  symbol: string
  timeframe: Timeframe
  fetched: number
  inserted: number
  skipped: number
  gaps: number
  latestTimestamp: Date | null
}

/**
 * Fetch OHLCV candles from Bybit and store in Supabase.
 * Performs incremental updates: only fetches what's missing.
 * Detects and logs gaps and duplicates.
 */
export async function fetchOHLCV(opts: FetchOptions): Promise<FetchResult> {
  const { symbol, timeframe, marketType } = opts
  const batchLimit = opts.limit ?? 1000
  const tfMs = TIMEFRAME_MS[timeframe]

  log.info({ symbol, timeframe, marketType }, 'Starting OHLCV fetch')

  // Determine start time
  let since: number
  if (opts.since) {
    since = opts.since.getTime()
  } else {
    const latest = await getLatestStoredTimestamp(symbol, timeframe, marketType)
    if (latest) {
      // Start from the last known candle + 1 bar (incremental)
      since = latest.getTime() + tfMs
      log.debug({ since: new Date(since).toISOString() }, 'Incremental fetch — starting after latest stored')
    } else {
      // Default backfill: 1 year of data
      since = Date.now() - 365 * 24 * 60 * 60_000
      log.info({ since: new Date(since).toISOString() }, 'No existing data — full backfill from 1 year ago')
    }
  }

  // Set market type on ccxt client
  bybitClient.options['defaultType'] = marketType === 'perp' ? 'swap' : 'spot'

  let totalFetched = 0
  let totalInserted = 0
  let totalSkipped = 0
  let gapCount = 0
  let currentSince = since
  let lastTimestamp: Date | null = null

  // Paginated fetch loop
  while (currentSince < Date.now() - tfMs) {
    let rawCandles: CcxtOHLCV[]

    try {
      rawCandles = await bybitClient.fetchOHLCV(symbol, timeframe, currentSince, batchLimit) as CcxtOHLCV[]
    } catch (err) {
      log.error({ symbol, timeframe, err }, 'Bybit OHLCV fetch failed')
      break
    }

    if (!rawCandles || rawCandles.length === 0) break

    totalFetched += rawCandles.length

    // Check for gaps (missing bars between last stored and first fetched)
    const firstCandle = rawCandles[0]
    if (lastTimestamp && firstCandle) {
      const expectedNext = lastTimestamp.getTime() + tfMs
      const actualFirst = (firstCandle[0] ?? 0) as number
      if (actualFirst > expectedNext + tfMs) {
        const gapBars = Math.round((actualFirst - expectedNext) / tfMs)
        log.warn({ symbol, timeframe, gapBars, expectedNext: new Date(expectedNext).toISOString(), actualFirst: new Date(actualFirst).toISOString() }, 'Gap detected in OHLCV data')
        gapCount += gapBars
      }
    }

    const rows = rawCandles.map(candle => ({
      exchange: 'bybit',
      symbol,
      timeframe,
      market_type: marketType,
      timestamp: new Date((candle[0] ?? 0) as number).toISOString(),
      open: (candle[1] ?? 0) as number,
      high: (candle[2] ?? 0) as number,
      low: (candle[3] ?? 0) as number,
      close: (candle[4] ?? 0) as number,
      volume: (candle[5] ?? 0) as number,
    }))

    // Upsert (ON CONFLICT DO NOTHING — skip duplicates)
    const { error, count } = await supabase
      .from('ohlcv_candles')
      .upsert(rows, {
        onConflict: 'exchange,symbol,timeframe,market_type,timestamp',
        ignoreDuplicates: true,
        count: 'exact',
      })

    if (error) {
      log.error({ symbol, timeframe, error }, 'Failed to upsert OHLCV candles')
      break
    }

    const inserted = count ?? 0
    const skipped = rows.length - inserted
    totalInserted += inserted
    totalSkipped += skipped

    const lastCandleRaw = rawCandles[rawCandles.length - 1]
    lastTimestamp = new Date(((lastCandleRaw ?? [])[0] ?? 0) as number)

    log.debug({
      symbol,
      timeframe,
      batchSize: rows.length,
      inserted,
      skipped,
      latest: lastTimestamp.toISOString(),
    }, 'Batch upserted')

    // Advance to next batch
    currentSince = lastTimestamp.getTime() + tfMs

    // Bybit returns < batchLimit when we've reached the latest candle
    if (rawCandles.length < batchLimit) break
  }

  // Log integrity check to database
  await supabase.from('data_integrity_log').insert({
    exchange: 'bybit',
    symbol,
    timeframe,
    market_type: marketType,
    check_type: 'fetch',
    status: gapCount > 0 ? 'warning' : 'ok',
    details: gapCount > 0 ? { gaps: gapCount } : null,
    candles_found: totalFetched,
    candles_added: totalInserted,
    gaps_detected: gapCount,
  })

  const result: FetchResult = {
    symbol,
    timeframe,
    fetched: totalFetched,
    inserted: totalInserted,
    skipped: totalSkipped,
    gaps: gapCount,
    latestTimestamp: lastTimestamp,
  }

  log.info(result, 'OHLCV fetch complete')
  return result
}

// ============================================================================
// Fetch funding rates (required for Strategy 001 — Funding Rate Extreme)
// ============================================================================

export interface FundingFetchResult {
  symbol: string
  fetched: number
  inserted: number
}

export async function fetchFundingRates(
  symbol: string,
  since?: Date
): Promise<FundingFetchResult> {
  log.info({ symbol }, 'Fetching funding rates')

  // Default: 1 year lookback
  const sinceTs = since?.getTime() ?? (Date.now() - 365 * 24 * 60 * 60_000)

  let rawRates: FundingRateHistory[] = []

  try {
    // ccxt fetchFundingRateHistory — Bybit supports up to 200 records per call
    rawRates = (await bybitClient.fetchFundingRateHistory(symbol, sinceTs)) as FundingRateHistory[]
  } catch (err) {
    log.error({ symbol, err }, 'Failed to fetch funding rate history')
    return { symbol, fetched: 0, inserted: 0 }
  }

  if (!rawRates || rawRates.length === 0) {
    log.warn({ symbol }, 'No funding rate data returned')
    return { symbol, fetched: 0, inserted: 0 }
  }

  const rows = rawRates.map(r => ({
    exchange: 'bybit',
    symbol,
    timestamp: new Date((r.timestamp ?? 0) as number).toISOString(),
    funding_rate: (r.fundingRate ?? 0) as number,
  }))

  const { error, count } = await supabase
    .from('funding_rates')
    .upsert(rows, {
      onConflict: 'exchange,symbol,timestamp',
      ignoreDuplicates: true,
      count: 'exact',
    })

  if (error) {
    log.error({ symbol, error }, 'Failed to upsert funding rates')
    return { symbol, fetched: rawRates.length, inserted: 0 }
  }

  const result = { symbol, fetched: rawRates.length, inserted: count ?? 0 }
  log.info(result, 'Funding rates stored')
  return result
}

// ============================================================================
// Load OHLCV from Supabase for backtesting
// ============================================================================

export interface LoadOptions {
  symbol: string
  timeframe: Timeframe
  marketType: MarketType
  from?: Date
  to?: Date
  limit?: number
}

/**
 * Load OHLCV candles from Supabase for use in backtest/indicators.
 * Data is already stored locally — no exchange call needed.
 */
export async function loadOHLCV(opts: LoadOptions): Promise<OHLCV[]> {
  let query = supabase
    .from('ohlcv_candles')
    .select('*')
    .eq('exchange', 'bybit')
    .eq('symbol', opts.symbol)
    .eq('timeframe', opts.timeframe)
    .eq('market_type', opts.marketType)
    .order('timestamp', { ascending: true })

  if (opts.from) query = query.gte('timestamp', opts.from.toISOString())
  if (opts.to)   query = query.lte('timestamp', opts.to.toISOString())
  if (opts.limit) query = query.limit(opts.limit)

  const { data, error } = await query

  if (error) {
    log.error({ opts, error }, 'Failed to load OHLCV from Supabase')
    throw new Error(`loadOHLCV failed: ${error.message}`)
  }

  return (data ?? []).map(row => ({
    timestamp:  new Date(row.timestamp as string),
    open:       Number(row.open),
    high:       Number(row.high),
    low:        Number(row.low),
    close:      Number(row.close),
    volume:     Number(row.volume),
    exchange:   row.exchange as OHLCV['exchange'],
    symbol:     row.symbol as string,
    timeframe:  row.timeframe as Timeframe,
    marketType: row.market_type as MarketType,
  }))
}

/**
 * Load funding rates from Supabase.
 */
export async function loadFundingRates(
  symbol: string,
  from?: Date,
  to?: Date
): Promise<FundingRate[]> {
  let query = supabase
    .from('funding_rates')
    .select('*')
    .eq('exchange', 'bybit')
    .eq('symbol', symbol)
    .order('timestamp', { ascending: true })

  if (from) query = query.gte('timestamp', from.toISOString())
  if (to)   query = query.lte('timestamp', to.toISOString())

  const { data, error } = await query

  if (error) {
    log.error({ symbol, error }, 'Failed to load funding rates from Supabase')
    throw new Error(`loadFundingRates failed: ${error.message}`)
  }

  return (data ?? []).map(row => ({
    timestamp:   new Date(row.timestamp as string),
    exchange:    'bybit',
    symbol:      row.symbol as string,
    fundingRate: Number(row.funding_rate),
  }))
}
