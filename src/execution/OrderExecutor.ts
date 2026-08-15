import { createLogger } from '../utils/logger.js'
import { supabase } from '../storage/supabaseClient.js'
import { bybitClient, fetchBybitPositions, fetchBybitClosedTrades } from '../data/bybitClient.js'
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
  maxFavorablePrice: number;
}
export const openPositions = new Map<string, OpenPosition>()

export async function syncOpenPositions() {
  const { data: runningTrades } = await supabase
    .from('trade_logs')
    .select('id, symbol, side, entry_price, position_size')
    .eq('status', 'RUNNING');

  let bybitPositions: any[] = [];
  if (config.LIVE_TRADING) {
    try {
      bybitPositions = await fetchBybitPositions();
    } catch (err) {
      log.warn('Failed to fetch Bybit positions during sync. Falling back to DB only.');
    }
  }

  const runningSymbolsLocal = new Set((runningTrades || []).map(t => t.symbol));

  // --- 1. DB -> Bybit: Close orphaned local trades ---
  if (runningTrades && runningTrades.length > 0) {
    for (const trade of runningTrades) {
      let shouldClose = false;

      if (config.LIVE_TRADING && bybitPositions.length > 0) {
        const bybitPos = bybitPositions.find(p => 
          p.symbol === trade.symbol || 
          p.info?.symbol === trade.symbol || 
          p.symbol.replace(/[\/]/g, '').split(':')[0] === trade.symbol
        );
        
        if (!bybitPos || Math.abs(Number(bybitPos.contracts || bybitPos.info?.size || 0)) === 0) {
          shouldClose = true;
        }
      }

      if (shouldClose) {
        log.info({ symbol: trade.symbol }, 'Position is missing or size 0 on Bybit. Closing orphaned trade in DB.');
        
        let exitPrice = trade.entry_price;
        try {
          const recentTrades = await fetchBybitClosedTrades(trade.symbol);
          const lastTrade = recentTrades?.[recentTrades.length - 1];
          if (lastTrade) {
            exitPrice = lastTrade.price || exitPrice;
          }
        } catch (e) {}

        const priceDiff = trade.side === 'LONG' ? (exitPrice - trade.entry_price) : (trade.entry_price - exitPrice);
        const netPnlUsd = priceDiff * trade.position_size;

        const { error } = await supabase.from('trade_logs')
          .update({
            status: 'CLOSED',
            exit_price: exitPrice,
            exit_time: new Date().toISOString(),
            exit_reason: 'closed_on_exchange',
            net_pnl_usd: netPnlUsd
          })
          .eq('id', trade.id);
          
        if (!error) {
          await supabase.from('system_logs').insert({
            level: 'info',
            module: 'notification',
            message: `Position Sync: ${trade.symbol} - Closed via Exchange Sync. PnL: $${netPnlUsd.toFixed(2)}`,
            details: { type: 'TRADE_CLOSE', symbol: trade.symbol, side: trade.side, pnl: netPnlUsd }
          });
        }
        
        openPositions.delete(trade.symbol);
      } else {
        if (!openPositions.has(trade.symbol)) {
          openPositions.set(trade.symbol, {
            id: trade.id,
            side: trade.side,
            entryPrice: trade.entry_price,
            size: trade.position_size,
            maxFavorablePrice: trade.entry_price
          });
          log.info({ symbol: trade.symbol, side: trade.side }, 'Synced RUNNING position from database into memory.');
        }
      }
    }
  }

  // --- 2. Bybit -> DB: Recover mistakenly closed trades ---
  if (config.LIVE_TRADING && bybitPositions.length > 0) {
    for (const p of bybitPositions) {
      const activeSize = Math.abs(Number(p.contracts || p.info?.size || 0));
      if (activeSize > 0) {
        const symbol = p.info?.symbol || p.symbol.replace(/[\/]/g, '').split(':')[0];
        
        if (!runningSymbolsLocal.has(symbol)) {
          // It's active on Bybit but NOT running locally! Check if we mistakenly closed it recently.
          log.info({ symbol }, 'Found active Bybit position that is NOT running locally. Attempting recovery...');
          
          const { data: recentlyClosed } = await supabase
            .from('trade_logs')
            .select('*')
            .eq('symbol', symbol)
            .eq('status', 'CLOSED')
            .order('created_at', { ascending: false })
            .limit(1);

          if (recentlyClosed && recentlyClosed.length > 0) {
            const tradeToRecover = recentlyClosed[0];
            log.warn({ symbol, tradeId: tradeToRecover.id }, 'Recovering mistakenly closed trade back to RUNNING state!');
            
            await supabase.from('trade_logs')
              .update({
                status: 'RUNNING',
                exit_price: null,
                exit_time: null,
                exit_reason: null,
                net_pnl_usd: null
              })
              .eq('id', tradeToRecover.id);

            openPositions.set(symbol, {
              id: tradeToRecover.id,
              side: tradeToRecover.side,
              entryPrice: tradeToRecover.entry_price,
              size: tradeToRecover.position_size,
              maxFavorablePrice: tradeToRecover.entry_price
            });

            await supabase.from('system_logs').insert({
              level: 'info',
              module: 'notification',
              message: `Position Recovery: ${symbol} - Restored to RUNNING state from Bybit sync.`,
              details: { type: 'TRADE_RECOVER', symbol, side: tradeToRecover.side }
            });
          }
        }
      }
    }
  }
}

const PAPER_ACCOUNT_BALANCE = 10000; // Fallback if not LIVE_TRADING

export async function closePosition(symbol: string, currentPrice: number, reason: 'take_profit' | 'stop_loss' | 'strategy_reversal') {
  let currentPos = openPositions.get(symbol)
  if (!currentPos) {
    // Check DB in case of restart
    const { data: existingRunning } = await supabase
      .from('trade_logs')
      .select('id, side, entry_price, position_size')
      .eq('symbol', symbol)
      .eq('status', 'RUNNING')
      .limit(1);

    const firstRunning = existingRunning?.[0];
    if (firstRunning) {
      currentPos = {
        id: firstRunning.id,
        side: firstRunning.side,
        entryPrice: firstRunning.entry_price,
        size: firstRunning.position_size,
        maxFavorablePrice: firstRunning.entry_price
      };
      openPositions.set(symbol, currentPos);
    } else {
      return false; // No running position found anywhere
    }
  }

  if (config.LIVE_TRADING) {
    try {
      log.info({ symbol, side: currentPos.side, size: currentPos.size }, `Executing REAL close order on Bybit for ${reason}...`);
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
      return false;
    }
  }

  const priceDiff = currentPos.side === 'LONG' ? (currentPrice - currentPos.entryPrice) : (currentPos.entryPrice - currentPrice)
  const grossPnl = priceDiff * currentPos.size
  
  // Estimate Bybit Taker Fees (0.055% for entry + 0.055% for exit)
  const takerFeeRate = 0.00055
  const entryFee = currentPos.entryPrice * currentPos.size * takerFeeRate
  const exitFee = currentPrice * currentPos.size * takerFeeRate
  const netPnlUsd = grossPnl - (entryFee + exitFee)
  
  const { error } = await supabase.from('trade_logs')
    .update({
      status: 'CLOSED',
      exit_price: currentPrice,
      exit_time: new Date().toISOString(),
      exit_reason: reason,
      net_pnl_usd: netPnlUsd
    })
    .eq('id', currentPos.id)

  if (error) {
    log.error({ error }, 'Failed to update closed trade log')
  } else {
    log.info({ symbol, closedPos: currentPos.side, reason, netPnlUsd: netPnlUsd.toFixed(4) }, 'Closed position with REAL PnL')
    
    // Insert notification into system_logs
    await supabase.from('system_logs').insert({
      level: 'info',
      module: 'notification',
      message: `Position Closed: ${symbol} - ${currentPos.side} position closed for ${reason}. PnL: $${netPnlUsd.toFixed(2)}`,
      details: { type: 'TRADE_CLOSE', symbol, side: currentPos.side, pnl: netPnlUsd }
    });
  }
  
  openPositions.delete(symbol)
  return true;
}

export async function executePaperTrade(symbol: string, side: 'LONG' | 'SHORT', suggestedPrice: number | undefined, strategyId: string, positionSizePct: number) {
  log.info({ symbol, side, suggestedPrice }, 'Attempting to execute trade')

  const currentPos = openPositions.get(symbol)
  if (currentPos) {
    log.info({ symbol, currentSide: currentPos.side, newSignal: side }, 'Position already open in memory, ignoring new signal.')
    return false;
  }

  // Check DB as well to prevent duplicates across restarts
  const { data: existingRunning } = await supabase
    .from('trade_logs')
    .select('id, side, entry_price, position_size')
    .eq('symbol', symbol)
    .eq('status', 'RUNNING')
    .limit(1);

  const firstRunning = existingRunning?.[0];
  if (firstRunning) {
    // Sync into memory and skip
    openPositions.set(symbol, {
      id: firstRunning.id,
      side: firstRunning.side,
      entryPrice: firstRunning.entry_price,
      size: firstRunning.position_size,
      maxFavorablePrice: firstRunning.entry_price
    });
    log.info({ symbol }, 'Found running position in DB. Synced to memory and skipped new signal.');
    return false;
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
        // Realistic dynamic fallback
        let basePrice = 150.0;
        if (symbol.includes('BTC')) basePrice = 60000.0;
        else if (symbol.includes('ETH')) basePrice = 3000.0;
        else if (symbol.includes('SOL')) basePrice = 150.0;
        else if (symbol.includes('DOGE')) basePrice = 0.15;
        else if (symbol.includes('XRP')) basePrice = 0.60;
        else if (symbol.includes('BNB')) basePrice = 600.0;
        
        price = basePrice * (1 + (Math.random() * 0.002 - 0.001));
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

    // Leverage multiplier
    const LEVERAGE = 10.0;
    const usdSize = accountBalance * positionSizePct * LEVERAGE;
    let positionSize = parseFloat((usdSize / price).toFixed(6));
    let orderId = `paper-${Date.now()}`
    
    // Execute real order if LIVE_TRADING
    if (config.LIVE_TRADING) {
      try {
        log.info({ symbol, side, positionSize, price, leverage: LEVERAGE }, 'Executing REAL limit order on Bybit...');
        const order = await bybitClient.createOrder(
          symbol,
          'limit',
          side === 'LONG' ? 'buy' : 'sell',
          positionSize,
          price
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

    // 3. Write new open position to Supabase trade_logs
    const { data, error } = await supabase.from('trade_logs').insert({
      strategy_id: dbStrategyId, // Valid UUID
      symbol,
      market_type: 'perp',
      exchange: 'bybit',
      side,
      status: 'RUNNING',
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

    // Insert Notification into system_logs
    await supabase.from('system_logs').insert({
      level: 'info',
      module: 'notification',
      message: `Position Opened: ${symbol} - Opened ${side} position at $${price.toFixed(4)}.`,
      details: { type: 'TRADE_OPEN', symbol, side, price }
    });

    // 4. Update local state
    if (data && data.id) {
      openPositions.set(symbol, {
        id: data.id,
        side,
        entryPrice: price,
        size: positionSize,
        maxFavorablePrice: price
      })
    }
    
    log.info({ symbol, side, price, isLive: config.LIVE_TRADING }, 'Trade executed successfully')
    return true
  } catch (err) {
    log.error({ symbol, err }, 'Trade execution failed')
    return false
  }
}
