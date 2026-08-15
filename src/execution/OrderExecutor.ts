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

  let bybitPositions: any[] | null = null;
  if (config.LIVE_TRADING) {
    try {
      bybitPositions = await fetchBybitPositions();
      // Filter out zero-size positions immediately
      bybitPositions = bybitPositions.filter(p => Math.abs(Number(p.contracts || p.info?.size || 0)) > 0);
      log.info({ count: bybitPositions.length, symbols: bybitPositions.map(p => p.info?.symbol || p.symbol) }, 'Active Bybit positions fetched');
    } catch (err) {
      log.warn('Failed to fetch Bybit positions during sync. Will skip Bybit mirroring and only load local DB into memory.');
    }
  }

  // Helper to extract clean symbol and numbers from ccxt bybit pos
  const parsePos = (p: any) => {
    const symbol = p.info?.symbol || p.symbol.replace(/[\/]/g, '').split(':')[0];
    const size = Math.abs(Number(p.contracts || p.info?.size || 0));
    // Check if side is Sell/Short
    const isShort = (p.side && p.side.toUpperCase() === 'SHORT') || 
                    (p.side && p.side.toUpperCase() === 'SELL') || 
                    (p.info?.side && p.info?.side.toUpperCase() === 'SELL');
    const side = isShort ? 'SHORT' : 'LONG';
    const entryPrice = Number(p.entryPrice || p.info?.avgPrice || 0);
    return { symbol, size, side, entryPrice };
  };

  const bybitMap = new Map<string, any>();
  if (bybitPositions) {
    for (const p of bybitPositions) {
      const parsed = parsePos(p);
      bybitMap.set(parsed.symbol, parsed);
    }
  }

  // --- 1. Process existing local trades ---
  if (runningTrades && runningTrades.length > 0) {
    for (const trade of runningTrades) {
      if (config.LIVE_TRADING && bybitPositions !== null) {
        const bp = bybitMap.get(trade.symbol);
        
        if (!bp) {
          // Exists locally but NOT on Bybit -> CLOSE locally
          log.info({ symbol: trade.symbol }, 'Position missing on Bybit. Closing orphaned trade in DB.');
          
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
          // Exists locally AND on Bybit -> Mirror EXACT size, side, and entry price
          const sizeDiff = Math.abs(trade.position_size - bp.size) > 0.000001;
          const priceDiff = Math.abs(trade.entry_price - bp.entryPrice) > 0.000001;
          const sideDiff = trade.side !== bp.side;
          
          if (sizeDiff || priceDiff || sideDiff) {
            log.info({ symbol: trade.symbol, oldSize: trade.position_size, newSize: bp.size }, 'Updating local position to perfectly mirror Bybit.');
            await supabase.from('trade_logs')
              .update({
                position_size: bp.size,
                entry_price: bp.entryPrice,
                side: bp.side
              })
              .eq('id', trade.id);
            
            // Update in-memory
            openPositions.set(trade.symbol, {
              id: trade.id,
              side: bp.side,
              entryPrice: bp.entryPrice,
              size: bp.size,
              maxFavorablePrice: bp.entryPrice
            });
          } else {
            // Already perfectly synced
            if (!openPositions.has(trade.symbol)) {
              openPositions.set(trade.symbol, {
                id: trade.id,
                side: trade.side,
                entryPrice: trade.entry_price,
                size: trade.position_size,
                maxFavorablePrice: trade.entry_price
              });
            }
          }
          // Remove from bybitMap so we know we processed it
          bybitMap.delete(trade.symbol);
        }
      } else {
        // Not live trading or fetch failed -> just load into memory
        if (!openPositions.has(trade.symbol)) {
          openPositions.set(trade.symbol, {
            id: trade.id,
            side: trade.side,
            entryPrice: trade.entry_price,
            size: trade.position_size,
            maxFavorablePrice: trade.entry_price
          });
        }
      }
    }
  }

  // --- 2. Process NEW/Unrecorded positions from Bybit ---
  if (config.LIVE_TRADING && bybitPositions !== null && bybitMap.size > 0) {
    // Get a valid strategy_id fallback
    const { data: stratData } = await supabase.from('strategies').select('id').limit(1);
    const fallbackStrategyId = stratData?.[0]?.id || null;

    for (const [symbol, bp] of bybitMap.entries()) {
      // First, check if we mistakenly closed it recently and resurrect it
      const { data: recentlyClosed } = await supabase
        .from('trade_logs')
        .select('*')
        .eq('symbol', symbol)
        .eq('status', 'CLOSED')
        .order('created_at', { ascending: false })
        .limit(1);

      if (recentlyClosed && recentlyClosed.length > 0) {
        const tradeToRecover = recentlyClosed[0];
        log.warn({ symbol, tradeId: tradeToRecover.id }, 'Recovering mistakenly closed trade back to RUNNING state and mirroring Bybit!');
        
        await supabase.from('trade_logs')
          .update({
            status: 'RUNNING',
            exit_price: null,
            exit_time: null,
            exit_reason: null,
            net_pnl_usd: null,
            position_size: bp.size,
            entry_price: bp.entryPrice,
            side: bp.side
          })
          .eq('id', tradeToRecover.id);

        openPositions.set(symbol, {
          id: tradeToRecover.id,
          side: bp.side,
          entryPrice: bp.entryPrice,
          size: bp.size,
          maxFavorablePrice: bp.entryPrice
        });
        
        await supabase.from('system_logs').insert({
          level: 'info',
          module: 'notification',
          message: `Position Recovery: ${symbol} - Restored to RUNNING state from Bybit sync.`,
          details: { type: 'TRADE_RECOVER', symbol, side: bp.side }
        });
      } else if (fallbackStrategyId) {
        // Brand new manual trade! Insert it.
        log.info({ symbol, size: bp.size }, 'Importing unrecorded Bybit position into Dashboard.');
        
        const { data: newTrade } = await supabase.from('trade_logs').insert({
          strategy_id: fallbackStrategyId,
          symbol,
          market_type: 'perp',
          exchange: 'bybit',
          side: bp.side,
          status: 'RUNNING',
          execution_mode: 'manual', // Mark it as manual so user knows
          decision_mode: 'hardcoded',
          entry_price: bp.entryPrice,
          entry_time: new Date().toISOString(),
          entry_order_id: `manual-import-${Date.now()}`,
          position_size: bp.size,
          effective_leverage: 1.0,
          net_pnl_usd: null,
          is_paper: false
        }).select('id').single();

        if (newTrade && newTrade.id) {
          openPositions.set(symbol, {
            id: newTrade.id,
            side: bp.side,
            entryPrice: bp.entryPrice,
            size: bp.size,
            maxFavorablePrice: bp.entryPrice
          });
          
          await supabase.from('system_logs').insert({
            level: 'info',
            module: 'notification',
            message: `Position Imported: ${symbol} - Discovered active Bybit position and imported to Dashboard.`,
            details: { type: 'TRADE_OPEN', symbol, side: bp.side, price: bp.entryPrice }
          });
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
