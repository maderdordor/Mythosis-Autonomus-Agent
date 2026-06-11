import { fetchOHLCV, fetchFundingRates } from '../src/data/bybitClient.js'
import { createLogger } from '../src/utils/logger.js'

const log = createLogger('dummy-fetch')

async function run() {
  log.info('--- Starting Dummy Fetch Test ---')

  try {
    // 1. Fetch OHLCV data for SOLUSDT perp on 1h timeframe
    // We fetch a very small batch just for testing (e.g. from 5 days ago)
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)

    log.info('Fetching OHLCV for SOLUSDT...')
    const ohlcvResult = await fetchOHLCV({
      symbol: 'SOLUSDT',
      timeframe: '1h',
      marketType: 'perp',
      since: fiveDaysAgo,
      limit: 200 // Max 200 candles per batch for quick test
    })

    log.info({ result: ohlcvResult }, 'OHLCV Fetch Completed')

    // 2. Fetch Funding Rates for SOLUSDT
    log.info('Fetching Funding Rates for SOLUSDT...')
    const fundingResult = await fetchFundingRates('SOLUSDT', fiveDaysAgo)

    log.info({ result: fundingResult }, 'Funding Rates Fetch Completed')

    log.info('--- Dummy Fetch Test Finished Successfully ---')
    process.exit(0)
  } catch (error) {
    log.error({ error }, 'Dummy Fetch Test Failed')
    process.exit(1)
  }
}

run()
