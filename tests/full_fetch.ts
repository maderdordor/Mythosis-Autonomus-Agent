/**
 * tests/full_fetch.ts
 * Full historical backfill: 1 year of OHLCV + Funding Rates → Supabase
 * Run: pnpm tsx tests/full_fetch.ts
 */
import { fetchOHLCV, fetchFundingRates } from '../src/data/bybitClient.js'
import { createLogger } from '../src/utils/logger.js'

const log = createLogger('full-fetch')

const SYMBOLS  = ['SOLUSDT', 'BTCUSDT', 'ETHUSDT']
const ONE_YEAR = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)

async function run() {
  log.info('=== Starting FULL historical backfill (1 year) ===')
  log.info({ since: ONE_YEAR.toISOString(), symbols: SYMBOLS }, 'Backfill parameters')

  for (const symbol of SYMBOLS) {
    log.info({ symbol }, `--- Fetching OHLCV 1h for ${symbol} ---`)
    try {
      const result = await fetchOHLCV({
        symbol,
        timeframe: '1h',
        marketType: 'perp',
        since: ONE_YEAR,
        limit: 1000  // Max batch size per request
      })
      log.info({ symbol, ...result }, 'OHLCV backfill complete')
    } catch (err) {
      log.error({ symbol, err }, 'OHLCV fetch failed — skipping symbol')
    }

    log.info({ symbol }, `--- Fetching Funding Rates for ${symbol} ---`)
    try {
      const frResult = await fetchFundingRates(symbol, ONE_YEAR)
      log.info({ symbol, ...frResult }, 'Funding Rate backfill complete')
    } catch (err) {
      log.error({ symbol, err }, 'Funding Rate fetch failed — skipping symbol')
    }
  }

  log.info('=== Full backfill finished! Ready to run optimizer ===')
  process.exit(0)
}

run()
