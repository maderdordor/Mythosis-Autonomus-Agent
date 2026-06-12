"""
tests/run_portfolio_optimizer.py
Gate 1 optimizer — runs grid search across MULTIPLE symbols (SOL, BTC, ETH)
and aggregates the results to find robust portfolio parameters.
"""

from __future__ import annotations
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
import pandas as pd
import numpy as np

# --- Resolve paths ---
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

from supabase import create_client
from engine.strategies.strategy_001 import FundingRateReversalStrategy
from engine.optimization.optimizer import generate_grid
from engine.backtest.engine import run_backtest

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

SYMBOLS = ["SOLUSDT", "DOGEUSDT", "AVAXUSDT", "LINKUSDT", "WIFUSDT"]
TIMEFRAME = "1h"

# ────────────────────────────────────────────────────────────────────────────
# Parameter Search Space
# ────────────────────────────────────────────────────────────────────────────
SEARCH_SPACE = {
    "funding_threshold": {
        "min": 0.0001,
        "max": 0.001,
        "step": 0.0002,
    },
    "funding_persistence_intervals": {
        "min": 1,
        "max": 2,
        "step": 1,
    },
    "ema_period": {
        "min": 5,
        "max": 20,
        "step": 5,
    },
    "rsi_period": {
        "min": 10,
        "max": 14,
        "step": 4,
    },
    "rsi_threshold_long": {
        "min": 40,
        "max": 50,
        "step": 5,
    },
    "rsi_threshold_short": {
        "min": 50,
        "max": 60,
        "step": 5,
    },
    "atr_sl_multiplier": {
        "min": 1.0,
        "max": 2.0,
        "step": 0.5,
    },
}

class PortfolioResult:
    def __init__(self, params):
        self.params = params
        self.total_trades = 0
        self.net_pnl_usd = 0.0
        self.sharpes = []
        self.dds = []
        self.win_rates = []
        self.fee_viability_pass = True

    @property
    def sharpe_ratio(self):
        return np.mean(self.sharpes) if self.sharpes else 0.0

    @property
    def max_drawdown_pct(self):
        return np.mean(self.dds) if self.dds else 0.0
        
    @property
    def win_rate_pct(self):
        return np.mean(self.win_rates) if self.win_rates else 0.0


def load_symbol_data(supa, symbol: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    print(f"📥 Loading {symbol} OHLCV...")
    all_rows = []
    page_size = 1000
    offset = 0
    while True:
        resp = supa.table("ohlcv_candles").select("*").eq("symbol", symbol).eq("timeframe", TIMEFRAME).order("timestamp", desc=False).range(offset, offset + page_size - 1).execute()
        if not resp.data: break
        all_rows.extend(resp.data)
        if len(resp.data) < page_size: break
        offset += page_size

    if not all_rows:
        return pd.DataFrame(), pd.DataFrame()

    candles_df = pd.DataFrame(all_rows)
    candles_df["timestamp"] = pd.to_datetime(candles_df["timestamp"])
    for col in ["open", "high", "low", "close", "volume"]:
        candles_df[col] = candles_df[col].astype(float)
    candles_df = candles_df.sort_values("timestamp").reset_index(drop=True)

    print(f"📥 Loading {symbol} Funding Rates...")
    fr_resp = supa.table("funding_rates").select("*").eq("symbol", symbol).order("timestamp", desc=False).execute()
    if fr_resp.data:
        fr_df = pd.DataFrame(fr_resp.data)
        fr_df["timestamp"] = pd.to_datetime(fr_df["timestamp"])
        fr_df["funding_rate"] = fr_df["funding_rate"].astype(float)
    else:
        fr_df = pd.DataFrame(columns=["timestamp", "funding_rate"])

    return candles_df, fr_df


def main():
    print("\n" + "="*70)
    print("  🚀 MYTHOS TRADING AGENT — PORTFOLIO OPTIMIZER")
    print("="*70)

    supa = create_client(SUPABASE_URL, SUPABASE_KEY)
    
    data_map = {}
    for sym in SYMBOLS:
        cdf, fdf = load_symbol_data(supa, sym)
        if not cdf.empty:
            data_map[sym] = (cdf, fdf)

    if not data_map:
        print("❌ No data loaded.")
        sys.exit(1)

    strategy = FundingRateReversalStrategy()
    grid = generate_grid(SEARCH_SPACE)
    print(f"\n🔢 Running {len(grid)} parameter combinations across {list(data_map.keys())}...\n")

    results = []
    for i, params in enumerate(grid):
        if i % 100 == 0:
            print(f"Progress: {i}/{len(grid)} combos evaluated...")
            
        p_res = PortfolioResult(params)
        
        for sym, (cdf, fdf) in data_map.items():
            res = run_backtest(
                strategy=strategy,
                candles=cdf,
                params=params,
                initial_equity=200.0,
                data_segment="in_sample",
                symbol=sym,
                timeframe=TIMEFRAME,
                funding_rates=fdf,
            )
            
            p_res.total_trades += res.total_trades
            p_res.net_pnl_usd += res.net_pnl_usd
            if res.total_trades > 0:
                p_res.sharpes.append(res.sharpe_ratio)
                p_res.dds.append(res.max_drawdown_pct)
                p_res.win_rates.append(res.win_rate_pct)
                if not res.fee_viability_pass:
                    p_res.fee_viability_pass = False
        
        # Only keep combinations that traded
        if p_res.total_trades > 0:
            results.append(p_res)

    print("\n" + "─"*70)
    print("  TOP 10 PORTFOLIO PARAMETER COMBINATIONS BY SHARPE RATIO")
    print("─"*70)
    
    sorted_r = sorted(results, key=lambda r: r.sharpe_ratio, reverse=True)
    for i, r in enumerate(sorted_r[:10], 1):
        status = "✅ VIABLE" if r.fee_viability_pass else "❌ fee fail"
        print(
            f"  [{i:02d}] AvgSharpe={r.sharpe_ratio:+.3f}  "
            f"TotalPnL={r.net_pnl_usd:+.2f}  "
            f"TotalTrades={r.total_trades}  "
            f"AvgWin%={r.win_rate_pct:.1f}  "
            f"AvgDD%={r.max_drawdown_pct*100:.2f}  "
            f"{status}"
        )
        print(f"       params: {r.params}")
    print("─"*70)

    if not sorted_r:
        print("\n  🔴 GATE 1: NO TRADES ACROSS PORTFOLIO")
        return

    best_res = sorted_r[0]
    print("\n" + "="*70)
    if best_res.fee_viability_pass and best_res.sharpe_ratio >= 1.0 and best_res.total_trades >= 10:
        print("  🟢 GATE 1: CANDIDATE FOUND — proceed to Walk-Forward Validation!")
    else:
        print("  🟡 GATE 1: TRADES FOUND but not yet PASS — tune parameters further")
    print("="*70 + "\n")

if __name__ == "__main__":
    main()
