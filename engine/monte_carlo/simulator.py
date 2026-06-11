"""
engine/monte_carlo/simulator.py
Monte Carlo Simulation engine to test strategy robustness against sequence of returns risk.
"""

from __future__ import annotations

import numpy as np
import structlog
from dataclasses import dataclass
from typing import Sequence

from engine.backtest.engine import TradeRecord
from engine.validation.final_verdict import MonteCarloResult, VERDICT_PASS, VERDICT_MARGINAL, VERDICT_FAIL

log = structlog.get_logger(__name__)


def run_monte_carlo(
    trades: Sequence[TradeRecord],
    initial_equity: float = 200.0,
    n_simulations: int = 10000,
    ruin_threshold_pct: float = 0.50,  # 50% drawdown = ruin
) -> MonteCarloResult:
    """
    Run Monte Carlo simulation by reshuffling the sequence of actual trades.
    We assume the trade returns (PnL percentage) are independent.
    
    Args:
        trades: List of executed trades from the backtest
        initial_equity: Starting capital
        n_simulations: Number of random sequences to generate
        ruin_threshold_pct: Percentage drop from peak equity considered "ruin"
    """
    if not trades:
        return MonteCarloResult(
            verdict=VERDICT_FAIL,
            prob_of_ruin=1.0,
            expected_shortfall=1.0,
            var_95=1.0,
            simulations_run=0,
            reasons=["No trades available for Monte Carlo simulation"],
        )
        
    log.info("Starting Monte Carlo simulation", n_sims=n_simulations, n_trades=len(trades))
    
    # Extract relative returns per trade.
    # Note: TradeRecord pnl_realized is absolute dollar value.
    # We need percentage return. For simplicity in this engine, we assume fixed sizing
    # relative to equity, so we can convert the trade absolute return back to a percentage
    # of the equity *at the time of the trade*, or simply use the raw dollar PnL sequence 
    # if position sizing was fixed fiat amount. 
    # Since backtest uses fixed fractional or fixed dollar sizing, we should replay the
    # percentage impact to simulate compounding, or just shuffle absolute PnL if not compounding.
    # For Mythos Phase 0 (simple validation), we shuffle absolute PnL and apply to initial equity.
    # This is more conservative.
    
    trade_pnls = np.array([t.pnl_realized for t in trades])
    n_trades = len(trade_pnls)
    
    ruin_count = 0
    max_drawdowns = np.zeros(n_simulations)
    final_equities = np.zeros(n_simulations)
    
    # We use vectorization where possible, but generating full matrices
    # for 10000 sims * 1000 trades can take memory. We process in batches.
    batch_size = 1000
    n_batches = (n_simulations + batch_size - 1) // batch_size
    
    ruin_absolute_threshold = initial_equity * (1.0 - ruin_threshold_pct)
    
    for b in range(n_batches):
        current_batch_size = min(batch_size, n_simulations - b * batch_size)
        
        # Generate random indices for reshuffling
        # Shape: (current_batch_size, n_trades)
        idx = np.random.randint(0, n_trades, size=(current_batch_size, n_trades))
        
        # Shape: (current_batch_size, n_trades)
        sim_pnls = trade_pnls[idx]
        
        # Cumulative PnL over time
        # Shape: (current_batch_size, n_trades)
        cum_pnls = np.cumsum(sim_pnls, axis=1)
        
        # Equity curves
        # Shape: (current_batch_size, n_trades)
        equity_curves = initial_equity + cum_pnls
        
        # Ruin logic: did the equity curve ever drop below ruin threshold?
        # We also check max drawdown relative to the peak of the curve up to that point
        
        # Running max for each path
        running_max = np.maximum.accumulate(equity_curves, axis=1)
        # Ensure running max is at least initial equity
        running_max = np.maximum(running_max, initial_equity)
        
        drawdowns = (running_max - equity_curves) / running_max
        max_dd = np.max(drawdowns, axis=1)
        
        ruins_in_batch = np.sum(np.any(equity_curves < ruin_absolute_threshold, axis=1))
        
        ruin_count += ruins_in_batch
        
        batch_start_idx = b * batch_size
        batch_end_idx = batch_start_idx + current_batch_size
        
        max_drawdowns[batch_start_idx:batch_end_idx] = max_dd
        final_equities[batch_start_idx:batch_end_idx] = equity_curves[:, -1]
        
    prob_of_ruin = float(ruin_count) / n_simulations
    var_95 = float(np.percentile(max_drawdowns, 95))
    
    # Expected Shortfall (CVaR): average of drawdowns worse than the 95th percentile
    tail_drawdowns = max_drawdowns[max_drawdowns > var_95]
    expected_shortfall = float(np.mean(tail_drawdowns)) if len(tail_drawdowns) > 0 else var_95
    
    reasons = []
    
    if prob_of_ruin > 0.05:
        reasons.append(f"Probability of Ruin: {prob_of_ruin:.1%} (> 5%)")
    if var_95 > 0.40:
        reasons.append(f"95% Value at Risk (Max DD): {var_95:.1%} (> 40%)")
    if expected_shortfall > 0.50:
        reasons.append(f"Expected Shortfall: {expected_shortfall:.1%} (> 50%)")
        
    if prob_of_ruin <= 0.01 and var_95 <= 0.25 and expected_shortfall <= 0.35:
        verdict = VERDICT_PASS
    elif prob_of_ruin <= 0.05 and var_95 <= 0.40 and expected_shortfall <= 0.50:
        verdict = VERDICT_MARGINAL
    else:
        verdict = VERDICT_FAIL

    res = MonteCarloResult(
        verdict=verdict,
        prob_of_ruin=prob_of_ruin,
        expected_shortfall=expected_shortfall,
        var_95=var_95,
        simulations_run=n_simulations,
        reasons=reasons,
    )
    
    log.info(
        "Monte Carlo Complete", 
        prob_ruin=res.prob_of_ruin,
        var95=res.var_95,
        verdict=res.verdict,
    )
    
    return res
