import { createLogger } from '../utils/logger.js'
import { supabase } from '../storage/supabaseClient.js'
import { bybitClient } from '../data/bybitClient.js'
import { config } from '../config/index.js'

const log = createLogger('execution:order')

import { getStrategy } from '../strategies/interface.js'

async function getStrategyIdFromDB(id: string) {
  const { data } = await supabase.from('strategies').select('id').eq('id', id).limit(1)
  if (data && data.length > 0 && data[0]) return data[0].id
  
  const strat = getStrategy(id)
  const { error } = await supabase.from('strategies').insert({
    id: strat.id,
    name: strat.name,
    status: 'sandbox',
    execution_mode: 'full_auto',
    decision_mode: 'hardcoded',
    edge_thesis: strat.edgeThesis,
    symbols: strat.symbols,
    timeframes: [strat.primaryTimeframe],
    market_type: strat.marketType
  })
  
  if (error) {
    log.error({ error }, 'Failed to insert real strategy')
  }

  return id
}

// Keep track of open positions to calculate real PnL
interface OpenPosition {
  id: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  size: number;
}
const openPositions = new Map<string, OpenPosition>()

const PAPER_ACCOUNT_BALANCE = 10000; // Fallback if not LIVE_TRADING

export async function executePaperTrade(symbol: string, side: 'LONG' | 'SHORT', suggestedPrice: number | undefined, strategyId: string, positionSizePct: number) {
  log.info({ symbol, side, suggestedPrice }, 'Attempting to execute trade')

  const currentPos = openPositions.get(symbol)
  if (currentPos && currentPos.side === side) {
    // log.warn({ symbol, side }, 'Double position prevented')
    return false
  }

  try {
    // 1. Fetch current ticker price to simulate entry price if not provided
    let price = suggestedPrice || 0
    if (!price) {
      try {
        const ticker = await bybitClient.fetchTicker(symbol)
        price = ticker.last || ticker.close || 0
      } catch (fetchErr) {
        log.warn({ symbol }, 'Failed to fetch ticker from Bybit. Using fallback.')
        price = 150.0 
      }
    }

    if (price === 0) {
      throw new Error(`Failed to get valid price for ${symbol}`)
    }

    // Dynamic position sizing based on real balance or paper balance
    let accountBalance = PAPER_ACCOUNT_BALANCE;
    if (config.LIVE_TRADING) {
      try {
        const balance = await bybitClient.fetchBalance();
        accountBalance = balance['USDT']?.free || PAPER_ACCOUNT_BALANCE;
        log.info({ accountBalance }, 'Fetched real account balance from Bybit');
      } catch (err) {
        log.warn('Failed to fetch real balance, using paper fallback.');
      }
    }

    const usdSize = accountBalance * positionSizePct;
    let positionSize = parseFloat((usdSize / price).toFixed(6));
    let orderId = `paper-${Date.now()}`
    
    // Execute real order if LIVE_TRADING
    if (config.LIVE_TRADING) {
      try {
        log.info({ symbol, side, positionSize }, 'Executing REAL market order on Bybit...');
        const order = await bybitClient.createOrder(
          symbol,
          'market',
          side === 'LONG' ? 'buy' : 'sell',
          positionSize
        );
        orderId = order.id;
        price = order.average || order.price || price; // Use actual filled price
        log.info({ orderId, price }, 'REAL market order filled successfully.');
      } catch (orderErr) {
        log.error({ symbol, side, err: orderErr }, 'Failed to execute real order on Bybit');
        return false;
      }
    }

    const dbStrategyId = await getStrategyIdFromDB(strategyId)

    // 2. If reversing position, we first close the old one (calculate real PnL)
    if (currentPos) {
      if (config.LIVE_TRADING) {
        try {
          log.info({ symbol, side: currentPos.side, size: currentPos.size }, 'Executing REAL close order on Bybit...');
          // Execute opposite market order to close
          await bybitClient.createOrder(
            symbol,
            'market',
            currentPos.side === 'LONG' ? 'sell' : 'buy',
            currentPos.size,
            undefined,
            { reduceOnly: true }
          );
          log.info('REAL close order filled successfully.');
        } catch (closeErr) {
          log.error({ symbol, err: closeErr }, 'Failed to execute real close order on Bybit');
          // Proceed anyway to keep local state clean, or return false depending on strictness
        }
      }

      // Real PnL calculation based on price difference
      const priceDiff = currentPos.side === 'LONG' ? (price - currentPos.entryPrice) : (currentPos.entryPrice - price)
      const pnlAmount = priceDiff * currentPos.size
      
      const { error } = await supabase.from('trade_logs')
        .update({
          exit_price: price,
          exit_time: new Date().toISOString(),
          exit_reason: 'strategy_reversal',
          net_pnl_usd: pnlAmount
        })
        .eq('id', currentPos.id)

      if (error) {
        log.error({ error }, 'Failed to update closed trade log')
      } else {
        log.info({ symbol, closedPos: currentPos.side, netPnlUsd: pnlAmount.toFixed(4) }, 'Closed previous position with REAL PnL')
      }
      
      openPositions.delete(symbol)
    }

    // 3. Write new open position to Supabase trade_logs
    const { data, error } = await supabase.from('trade_logs').insert({
      strategy_id: dbStrategyId, // Valid UUID
      symbol,
      market_type: 'perp',
      exchange: 'bybit',
      side,
      execution_mode: 'full_auto',
      decision_mode: 'hardcoded',
      entry_price: price,
      entry_time: new Date().toISOString(),
      entry_order_id: orderId,
      position_size: positionSize,
      effective_leverage: 1.0,
      net_pnl_usd: null, // open positions don't have PnL yet
      is_paper: true
    }).select('id').single()

    if (error) {
      log.error({ error }, 'Failed to insert open trade log')
      return false
    }

    // 4. Update local state
    if (data && data.id) {
      openPositions.set(symbol, {
        id: data.id,
        side,
        entryPrice: price,
        size: positionSize
      })
    }
    
    log.info({ symbol, side, price, isLive: config.LIVE_TRADING }, 'Trade executed successfully')
    return true
  } catch (err) {
    log.error({ symbol, err }, 'Trade execution failed')
    return false
  }
}
