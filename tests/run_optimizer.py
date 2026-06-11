"""
tests/run_optimizer.py
Gate 1 optimizer — runs grid search on real Supabase data to find
the most robust parameter set for Strategy 001.

Usage: python3 tests/run_optimizer.py
"""

from __future__ import annotations
import os
import sys
from pathlib import Path
from datetime import datetime, timezone

from dotenv import load_dotenv
import pandas as pd

# --- Resolve paths ---
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

from supabase import create_client
from engine.strategies.strategy_001 import FundingRateReversalStrategy
from engine.optimization.optimizer import optimize_grid

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

SYMBOL    = "SOLUSDT"
TIMEFRAME = "1h"

# ────────────────────────────────────────────────────────────────────────────
# Parameter Search Space
# We intentionally keep the grid modest for Gate 1 speed.
# Expand later in Phase 1 research.
# ────────────────────────────────────────────────────────────────────────────
SEARCH_SPACE = {
    "funding_threshold": {
        "min": 0.0005,   # 0.05%
        "max": 0.002,    # 0.20%
        "step": 0.0005,
    },
    "funding_persistence_intervals": {
        "min": 1,
        "max": 3,
        "step": 1,
    },
    "ema_period": {
        "min": 10,
        "max": 30,
        "step": 10,
    },
    "rsi_period": {
        "min": 10,
        "max": 14,
        "step": 4,
    },
    "rsi_threshold_long": {
        "min": 35,
        "max": 50,
        "step": 5,
    },
    "rsi_threshold_short": {
        "min": 50,
        "max": 65,
        "step": 5,
    },
    "atr_sl_multiplier": {
        "min": 1.0,
        "max": 2.5,
        "step": 0.5,
    },
}


def load_data() -> tuple[pd.DataFrame, pd.DataFrame]:
    print(f"\n📥  Loading {SYMBOL} OHLCV from Supabase…")
    supa = create_client(SUPABASE_URL, SUPABASE_KEY)

    resp = (
        supa.table("ohlcv")
        .select("*")
        .eq("symbol", SYMBOL)
        .eq("timeframe", TIMEFRAME)
        .order("timestamp", desc=False)
        .execute()
    )
    if not resp.data:
        print("❌  No OHLCV data found! Run tests/full_fetch.ts first.")
        sys.exit(1)

    candles_df = pd.DataFrame(resp.data)
    candles_df["timestamp"] = pd.to_datetime(candles_df["timestamp"])
    for col in ["open", "high", "low", "close", "volume"]:
        candles_df[col] = candles_df[col].astype(float)
    candles_df = candles_df.sort_values("timestamp").reset_index(drop=True)
    print(f"   ✅  Loaded {len(candles_df)} candles  "
          f"({candles_df['timestamp'].iloc[0].date()} → {candles_df['timestamp'].iloc[-1].date()})")

    print(f"\n📥  Loading {SYMBOL} Funding Rates from Supabase…")
    fr_resp = (
        supa.table("funding_rates")
        .select("*")
        .eq("symbol", SYMBOL)
        .order("timestamp", desc=False)
        .execute()
    )
    if fr_resp.data:
        fr_df = pd.DataFrame(fr_resp.data)
        fr_df["timestamp"] = pd.to_datetime(fr_df["timestamp"])
        fr_df["funding_rate"] = fr_df["funding_rate"].astype(float)
        print(f"   ✅  Loaded {len(fr_df)} funding rate records")
    else:
        print("   ⚠️   No funding rate data — using empty DataFrame")
        fr_df = pd.DataFrame(columns=["timestamp", "funding_rate"])

    return candles_df, fr_df


def print_top_results(results, n=10):
    print(f"\n{'─'*70}")
    print(f"  TOP {n} PARAMETER COMBINATIONS BY SHARPE RATIO")
    print(f"{'─'*70}")
    sorted_r = sorted(results, key=lambda r: r.sharpe_ratio, reverse=True)
    for i, r in enumerate(sorted_r[:n], 1):
        status = "✅ VIABLE" if r.fee_viable else "❌ fee fail"
        print(
            f"  [{i:02d}] Sharpe={r.sharpe_ratio:+.3f}  "
            f"PnL={r.net_pnl_usd:+.2f}  "
            f"Trades={r.total_trades}  "
            f"Win%={r.win_rate*100:.1f}  "
            f"DD%={r.max_drawdown_pct*100:.2f}  "
            f"{status}"
        )
        ft = r.params.get("funding_threshold", "?")
        ema = r.params.get("ema_period", "?")
        rsi = r.params.get("rsi_period", "?")
        atr = r.params.get("atr_sl_multiplier", "?")
        fp = r.params.get("funding_persistence_intervals", "?")
        print(f"       params: fund_thresh={ft}  ema={ema}  rsi={rsi}  atr_sl={atr}  persist={fp}")
    print(f"{'─'*70}")


def main():
    print("\n" + "="*70)
    print("  🚀 MYTHOS TRADING AGENT — GATE 1 OPTIMIZER")
    print("="*70)

    candles_df, fr_df = load_data()

    strategy = FundingRateReversalStrategy()

    # Quick combo count
    from engine.optimization.optimizer import generate_grid
    grid = generate_grid(SEARCH_SPACE)
    print(f"\n🔢  Running {len(grid)} parameter combinations…\n")

    opt_result = optimize_grid(
        strategy=strategy,
        candles=candles_df,
        search_space=SEARCH_SPACE,
        initial_equity=200.0,
        symbol=SYMBOL,
        timeframe=TIMEFRAME,
        funding_rates=fr_df,
    )

    print_top_results(opt_result.all_results, n=10)

    print(f"\n🏆  BEST (Raw) PARAMS:    {opt_result.best_params}")
    print(f"🛡️   ROBUST ZONE PARAMS:  {opt_result.robust_params}")
    print(f"    Flat Region Score:   {opt_result.flat_region_score:.2f}/1.0")

    # Flag Gate 1 status
    best_res = max(opt_result.all_results, key=lambda r: r.sharpe_ratio)
    print("\n" + "="*70)
    if best_res.fee_viable and best_res.sharpe_ratio >= 1.0 and best_res.total_trades >= 10:
        print("  🟢 GATE 1: CANDIDATE FOUND — proceed to Walk-Forward Validation!")
    elif best_res.total_trades == 0:
        print("  🔴 GATE 1: NO TRADES — loosen funding_threshold or fetch more data")
    else:
        print("  🟡 GATE 1: TRADES FOUND but not yet PASS — tune parameters further")
    print("="*70 + "\n")


if __name__ == "__main__":
    main()
