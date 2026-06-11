"""
engine/wfo/walk_forward.py
Walk-Forward Optimization (WFO) Engine.
Executes rolling window optimization and evaluates generalizability.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
import structlog

from engine.backtest.engine import BacktestResult, BacktestStrategy, run_backtest
from engine.optimization.optimizer import optimize_grid
from engine.validation.final_verdict import WFOResult, VERDICT_PASS, VERDICT_MARGINAL, VERDICT_FAIL

log = structlog.get_logger(__name__)


@dataclass
class WFOWindow:
    window_id: int
    is_start: pd.Timestamp
    is_end: pd.Timestamp
    oos_start: pd.Timestamp
    oos_end: pd.Timestamp
    params: dict[str, Any]
    is_metrics: BacktestResult
    oos_metrics: BacktestResult


def run_wfo(
    strategy: BacktestStrategy,
    candles: pd.DataFrame,
    search_space: dict[str, dict[str, float]],
    n_windows: int = 5,
    oos_ratio: float = 0.2,
    initial_equity: float = 200.0,
    symbol: str = "UNKNOWN",
    timeframe: str = "1h",
    funding_rates: pd.DataFrame | None = None,
) -> WFOResult:
    """
    Run Walk-Forward Optimization.
    Splits data into N rolling windows. Each window has an In-Sample (IS) 
    and Out-Of-Sample (OOS) portion.
    """
    
    total_bars = len(candles)
    if total_bars < 1000:
        log.warning("Insufficient data for WFO (<1000 bars)", bars=total_bars)
        
    # Calculate window sizes
    # If oos_ratio = 0.2, then each step forward is 1 OOS period
    # Total data covers IS_length + n_windows * OOS_length
    # Let IS_length = (1 - oos_ratio) * window_length
    # Let OOS_length = oos_ratio * window_length
    
    # A simple anchored or rolling approach:
    # Here we do a rolling window:
    # window_size = total_bars / (1 + (n_windows - 1) * oos_ratio)
    
    window_size = int(total_bars / (1 + (n_windows - 1) * oos_ratio))
    oos_size = int(window_size * oos_ratio)
    is_size = window_size - oos_size
    
    log.info(
        "Starting WFO",
        total_bars=total_bars,
        n_windows=n_windows,
        is_bars_per_window=is_size,
        oos_bars_per_window=oos_size,
    )
    
    windows: list[WFOWindow] = []
    
    for i in range(n_windows):
        is_start_idx = i * oos_size
        is_end_idx = is_start_idx + is_size
        oos_start_idx = is_end_idx
        oos_end_idx = min(oos_start_idx + oos_size, total_bars)
        
        if oos_start_idx >= total_bars:
            break
            
        is_candles = candles.iloc[is_start_idx:is_end_idx]
        oos_candles = candles.iloc[oos_start_idx:oos_end_idx]
        
        # Optimize on IS
        opt_res = optimize_grid(
            strategy=strategy,
            candles=is_candles,
            search_space=search_space,
            initial_equity=initial_equity,
            symbol=symbol,
            timeframe=timeframe,
            funding_rates=funding_rates,
        )
        
        # We use the robust params for the OOS run
        chosen_params = opt_res.robust_params or opt_res.best_params
        
        # Evaluate on OOS
        oos_res = run_backtest(
            strategy=strategy,
            candles=oos_candles,
            params=chosen_params,
            initial_equity=initial_equity,
            data_segment="out_sample",
            symbol=symbol,
            timeframe=timeframe,
            funding_rates=funding_rates,
        )
        
        # Get IS metrics for the chosen params
        is_res = None
        for r in opt_res.all_results:
            if r.params == chosen_params:
                is_res = r
                break
                
        if not is_res:
            # Fallback
            is_res = run_backtest(
                strategy=strategy,
                candles=is_candles,
                params=chosen_params,
                initial_equity=initial_equity,
                data_segment="in_sample",
                symbol=symbol,
                timeframe=timeframe,
                funding_rates=funding_rates,
            )
            
        w = WFOWindow(
            window_id=i+1,
            is_start=is_candles.iloc[0]["timestamp"],
            is_end=is_candles.iloc[-1]["timestamp"],
            oos_start=oos_candles.iloc[0]["timestamp"],
            oos_end=oos_candles.iloc[-1]["timestamp"],
            params=chosen_params,
            is_metrics=is_res,
            oos_metrics=oos_res,
        )
        windows.append(w)
        
        log.info(
            "WFO Window Complete",
            window=i+1,
            is_sharpe=round(is_res.sharpe_ratio, 2),
            oos_sharpe=round(oos_res.sharpe_ratio, 2),
            oos_return=round(oos_res.total_return_pct, 2),
        )

    # Calculate aggregate WFO metrics
    oos_returns = [w.oos_metrics.total_return_pct for w in windows]
    oos_sharpes = [w.oos_metrics.sharpe_ratio for w in windows]
    
    profitable_windows = sum(1 for r in oos_returns if r > 0)
    profitable_windows_pct = profitable_windows / len(windows) if windows else 0
    
    mean_oos_sharpe = float(np.mean(oos_sharpes)) if oos_sharpes else 0.0
    std_oos_sharpe = float(np.std(oos_sharpes)) if oos_sharpes else 0.0
    oos_sharpe_cv = (std_oos_sharpe / mean_oos_sharpe) if mean_oos_sharpe > 0 else float('inf')
    
    # Check single window dominance
    total_oos_profit = sum(max(0, r) for r in oos_returns)
    single_window_dominance = any(
        (max(0, r) / total_oos_profit > 0.5) 
        for r in oos_returns
    ) if total_oos_profit > 0 else False
    
    # Build reasons
    reasons = []
    if profitable_windows_pct < 0.70:
        reasons.append(f"Profitable windows: {profitable_windows_pct:.0%} (< 70%)")
    if mean_oos_sharpe <= 1.0:
        reasons.append(f"Mean OOS Sharpe: {mean_oos_sharpe:.2f} (<= 1.0)")
    if oos_sharpe_cv > 1.0:
        reasons.append(f"OOS Sharpe CV: {oos_sharpe_cv:.2f} (> 1.0 - high variance)")
    if single_window_dominance:
        reasons.append("Single window dominance detected (>50% profit from one window)")
        
    # Verdict logic (Section 8.6)
    if profitable_windows_pct >= 0.70 and mean_oos_sharpe > 1.0 and not single_window_dominance and oos_sharpe_cv <= 1.0:
        verdict = VERDICT_PASS
    elif profitable_windows_pct >= 0.60 and mean_oos_sharpe > 0.8 and not single_window_dominance:
        verdict = VERDICT_MARGINAL
    else:
        verdict = VERDICT_FAIL
        
    return WFOResult(
        verdict=verdict,
        profitable_windows_pct=profitable_windows_pct,
        mean_oos_sharpe=mean_oos_sharpe,
        oos_sharpe_cv=oos_sharpe_cv,
        flat_region_score=1.0,  # Placeholder, derived from opt logic
        parameter_stable=True,  # Simplified for MVP
        single_window_dominance=single_window_dominance,
        reasons=reasons,
    )
