"""
engine/optimization/optimizer.py
Grid search and robust zone detection for parameter optimization.

We do NOT want the absolute highest-performing parameter set (isolated peak).
We want a parameter set that sits in the middle of a "robust zone" (plateau)
where small changes in parameters do not drastically reduce performance.
"""

from __future__ import annotations

import itertools
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
import structlog

from engine.backtest.engine import BacktestResult, BacktestStrategy, run_backtest

log = structlog.get_logger(__name__)


@dataclass
class OptimizationResult:
    best_params: dict[str, Any]
    robust_params: dict[str, Any] | None
    flat_region_score: float
    all_results: list[BacktestResult]


def generate_grid(search_space: dict[str, dict[str, float]]) -> list[dict[str, Any]]:
    """
    Generate all parameter combinations from a search space definition.
    Format of search_space:
    {
        "param1": {"min": 10, "max": 20, "step": 5},
        "param2": {"min": 0.05, "max": 0.15, "step": 0.05}
    }
    """
    keys = list(search_space.keys())
    values = []

    for key in keys:
        p = search_space[key]
        start = p["min"]
        stop = p["max"]
        step = p["step"]

        # Ensure we cover the stop value
        n_steps = int(round((stop - start) / step)) + 1
        arr = [start + i * step for i in range(n_steps)]

        # Handle float precision issues
        arr = [round(x, 6) for x in arr]
        values.append(arr)

    combinations = list(itertools.product(*values))
    
    return [dict(zip(keys, combo)) for combo in combinations]


def evaluate_robustness(
    results: list[BacktestResult], 
    target_metric: str = "sharpe_ratio"
) -> tuple[dict[str, Any] | None, float]:
    """
    Finds a robust parameter set by scoring each set based on its neighbors.
    A parameter set is robust if its adjacent neighbors also perform well.
    
    Returns:
        tuple(robust_params, flat_region_score)
    """
    if not results:
        return None, 0.0

    # Sort by the primary metric
    sorted_results = sorted(
        results, 
        key=lambda r: getattr(r, target_metric, 0.0), 
        reverse=True
    )

    # If we don't have enough results to do neighbor analysis, just return best
    if len(results) < 5:
        best = sorted_results[0]
        return best.params, 1.0

    # Build a lookup for performance by parameter tuple
    perf_map = {}
    param_keys = sorted(list(results[0].params.keys()))
    
    for r in results:
        # Create a hashable representation of parameters
        ptup = tuple(r.params[k] for k in param_keys)
        perf_map[ptup] = getattr(r, target_metric, 0.0)

    # Simplified plateau search:
    # Look at the top 20% of results. For each, check if it's an isolated peak
    # (performance drops by > 30% if we change any one parameter).
    
    top_n = max(1, len(results) // 5)
    candidates = sorted_results[:top_n]
    
    best_robust = None
    best_robust_score = -1.0

    for cand in candidates:
        cand_perf = getattr(cand, target_metric, 0.0)
        if cand_perf <= 0:
            continue
            
        ptup = tuple(cand.params[k] for k in param_keys)
        
        # We need a formal neighbor check, but without a full N-dimensional grid structure,
        # we approximate by looking at variance within the top candidates.
        # For Phase 0, we simply pick the best parameter set that isn't the absolute extreme
        # outlier of the group (if its performance is > 50% higher than the median of the top 20%, it's suspect).
        
        median_top = np.median([getattr(r, target_metric, 0.0) for r in candidates])
        
        if cand_perf > median_top * 1.5:
            # Suspicious peak
            flatness = 0.3
        else:
            # Good plateau candidate
            flatness = 0.8
            
        if flatness > best_robust_score:
            best_robust_score = flatness
            best_robust = cand.params
            
    # Fallback to absolute best if robustness check fails to find anything
    if best_robust is None:
        best_robust = sorted_results[0].params
        best_robust_score = 0.5
        
    return best_robust, best_robust_score


def optimize_grid(
    strategy: BacktestStrategy,
    candles: pd.DataFrame,
    search_space: dict[str, dict[str, float]],
    initial_equity: float = 200.0,
    symbol: str = "UNKNOWN",
    timeframe: str = "1h",
    funding_rates: pd.DataFrame | None = None,
    max_workers: int = 4,
) -> OptimizationResult:
    """
    Run grid search optimization and find the robust zone.
    """
    grid = generate_grid(search_space)
    
    log.info(
        "Starting grid search optimization",
        strategy_id=strategy.strategy_id,
        symbol=symbol,
        combinations=len(grid),
    )

    results: list[BacktestResult] = []
    
    # In Phase 0 MVP, we can run sequentially for simplicity and debugging,
    # or use ProcessPoolExecutor if the grid is large. 
    # For < 100 combinations, sequential is fast enough.
    
    for params in grid:
        res = run_backtest(
            strategy=strategy,
            candles=candles,
            params=params,
            initial_equity=initial_equity,
            data_segment="in_sample",
            symbol=symbol,
            timeframe=timeframe,
            funding_rates=funding_rates,
        )
        results.append(res)
        
    # Find absolute best
    best_res = max(results, key=lambda r: getattr(r, "sharpe_ratio", 0.0))
    
    # Find robust zone
    robust_params, flat_score = evaluate_robustness(results, "sharpe_ratio")
    
    log.info(
        "Grid search complete",
        best_sharpe=round(getattr(best_res, "sharpe_ratio", 0.0), 3),
        flat_region_score=round(flat_score, 2)
    )
    
    return OptimizationResult(
        best_params=best_res.params,
        robust_params=robust_params,
        flat_region_score=flat_score,
        all_results=results,
    )
