"""
tests/dummy_backtest.py
Dummy script to test Strategy 001 backtest engine execution.
"""
import asyncio
import os
import sys

# Ensure engine path is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__line__ if '__file__' not in locals() else __file__), '..')))

import pandas as pd
from datetime import datetime, timedelta, timezone

# We will import the supabase client from python to fetch the data directly
# But wait, in python we don't have a direct wrapper for the TS supabase fetcher yet.
# Let's write a quick one using the python supabase client.
from supabase import create_client, Client
from engine.utils.config import cfg
from engine.strategies.strategy_001 import FundingRateReversalStrategy
from engine.backtest.engine import run_backtest

def main():
    print("--- Starting Dummy Backtest Test ---")
    
    supabase_url = os.getenv("SUPABASE_URL", "")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", os.getenv("SUPABASE_ANON_KEY", ""))
    
    if not supabase_url or not supabase_key:
        print("Error: SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env")
        sys.exit(1)
        
    supabase: Client = create_client(supabase_url, supabase_key)
    
    print("Fetching OHLCV data from Supabase...")
    # Fetch last 500 hours (approx 20 days) for SOLUSDT 1h
    response = supabase.table('ohlcv_candles')\
        .select('*')\
        .eq('exchange', 'bybit')\
        .eq('symbol', 'SOLUSDT')\
        .eq('timeframe', '1h')\
        .eq('market_type', 'perp')\
        .order('timestamp', desc=False)\
        .execute()
        
    if not response.data:
        print("Error: No OHLCV data found. Please run 'pnpm tsx tests/dummy_fetch.ts' first.")
        sys.exit(1)
        
    candles_df = pd.DataFrame(response.data)
    # Convert types
    candles_df['timestamp'] = pd.to_datetime(candles_df['timestamp'])
    for col in ['open', 'high', 'low', 'close', 'volume']:
        candles_df[col] = candles_df[col].astype(float)
        
    print(f"Loaded {len(candles_df)} candles. Date range: {candles_df['timestamp'].min()} to {candles_df['timestamp'].max()}")
    
    print("Fetching Funding Rates from Supabase...")
    fr_response = supabase.table('funding_rates')\
        .select('*')\
        .eq('exchange', 'bybit')\
        .eq('symbol', 'SOLUSDT')\
        .order('timestamp', desc=False)\
        .execute()
        
    if fr_response.data:
        fr_df = pd.DataFrame(fr_response.data)
        fr_df['timestamp'] = pd.to_datetime(fr_df['timestamp'])
        fr_df['funding_rate'] = fr_df['funding_rate'].astype(float)
        print(f"Loaded {len(fr_df)} funding rate records.")
    else:
        print("Warning: No funding rate data found.")
        fr_df = pd.DataFrame(columns=['timestamp', 'funding_rate'])
        
    # Instantiate strategy
    strategy = FundingRateReversalStrategy()
    
    # Run backtest
    params = {
        "funding_threshold": 0.001,  # 0.1% extreme
        "funding_persistence_intervals": 1, # Just 1 for dummy test to ensure signals generate
        "ema_period": 20,
        "rsi_period": 14,
        "rsi_threshold_long": 45,
        "rsi_threshold_short": 55,
        "atr_sl_multiplier": 1.5
    }
    
    print("Running backtest engine...")
    result = run_backtest(
        strategy=strategy,
        candles=candles_df,
        params=params,
        initial_equity=200.0,
        data_segment="test",
        symbol="SOLUSDT",
        timeframe="1h",
        funding_rates=fr_df
    )
    
    print(f"Backtest completed!")
    print(f"Total Trades: {result.total_trades}")
    print(f"Net PnL (USD): {result.net_pnl_usd:.2f}")
    print(f"Total Return: {result.total_return_pct:.2f}%")
    print(f"Win Rate: {result.win_rate_pct:.1f}%")
    print(f"Max Drawdown: {result.max_drawdown_pct:.2f}%")
    
    print("--- Dummy Backtest Test Finished Successfully ---")

if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    main()
