"""
engine/backtest/engine.py
Core backtesting engine for Mythos Trading Agent.

Design principles:
- Realistic execution: ENTRY_DELAY_BARS, fees, slippage
- Fee viability check is mandatory (Section 3.4)
- No lookahead bias: signals computed on bar close, executed next bar open
- Pure function: same inputs always produce same outputs (deterministic)
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol, runtime_checkable

import numpy as np
import pandas as pd
import structlog

from engine.utils.config import cfg

log = structlog.get_logger(__name__)


# ============================================================================
# Data types
# ============================================================================

@dataclass
class Trade:
    id: str
    strategy_id: str
    symbol: str
    side: str               # 'long' | 'short'
    entry_bar: int          # Index into candle array
    exit_bar: int
    entry_price: float
    exit_price: float
    stop_loss_price: float
    take_profit_price: float
    position_size: float    # In base units (e.g. SOL)
    gross_pnl_usd: float
    fees_paid_usd: float
    slippage_cost_usd: float
    net_pnl_usd: float
    net_pnl_pct: float      # As fraction of trade equity
    r_multiple: float       # Net PnL / initial risk
    holding_bars: int
    exit_reason: str        # 'take_profit' | 'stop_loss' | 'time_exit' | 'signal_exit'
    entry_time: datetime
    exit_time: datetime
    initial_risk_usd: float
    indicators_at_entry: dict[str, float] = field(default_factory=dict)


@dataclass
class BacktestResult:
    strategy_id: str
    symbol: str
    timeframe: str
    data_segment: str          # 'full' | 'in_sample' | 'out_sample' | 'holdout'
    params: dict[str, Any]
    trades: list[Trade]
    equity_curve: list[float]  # Equity at each bar
    data_start: datetime
    data_end: datetime

    # --- Computed metrics (populated by compute_metrics) ---
    total_return_pct: float = 0.0
    net_pnl_usd: float = 0.0
    cagr_pct: float = 0.0
    max_drawdown_pct: float = 0.0
    sharpe_ratio: float = 0.0
    sortino_ratio: float = 0.0
    calmar_ratio: float = 0.0
    profit_factor: float = 0.0
    win_rate_pct: float = 0.0
    expectancy_usd: float = 0.0
    avg_win_usd: float = 0.0
    avg_loss_usd: float = 0.0
    best_trade_usd: float = 0.0
    worst_trade_usd: float = 0.0
    total_trades: int = 0
    long_trades: int = 0
    short_trades: int = 0
    max_consec_wins: int = 0
    max_consec_losses: int = 0
    exposure_time_pct: float = 0.0
    avg_hold_bars: float = 0.0
    fees_paid_usd: float = 0.0
    slippage_cost_usd: float = 0.0

    # Fee viability (Section 3.4)
    avg_gross_edge_pct: float = 0.0
    round_trip_cost_pct: float = 0.0
    fee_viability_pass: bool = False


# ============================================================================
# Strategy protocol — what the backtest engine expects from any strategy
# ============================================================================

@runtime_checkable
class BacktestStrategy(Protocol):
    """
    Protocol that any strategy must satisfy for the backtest engine.
    The engine calls generate_signals() and reads the returned signals.
    """

    strategy_id: str

    def generate_signals(
        self,
        candles: pd.DataFrame,
        params: dict[str, Any],
        funding_rates: pd.DataFrame | None = None,
    ) -> pd.DataFrame:
        """
        Generate signals for each bar.

        Args:
            candles: DataFrame with columns [timestamp, open, high, low, close, volume]
            params: Strategy parameters
            funding_rates: Optional funding rate DataFrame [timestamp, funding_rate]

        Returns:
            DataFrame with same index as candles, plus columns:
              signal: int  (1 = long, -1 = short, 0 = flat/no signal)
              stop_loss_price: float
              take_profit_price: float
              position_size_pct: float  (fraction of equity to risk, e.g. 0.005)
              signal_reason: str (human-readable reason)
        """
        ...


# ============================================================================
# Backtest engine
# ============================================================================

def run_backtest(
    strategy: BacktestStrategy,
    candles: pd.DataFrame,
    params: dict[str, Any],
    initial_equity: float = 200.0,
    data_segment: str = "full",
    symbol: str = "UNKNOWN",
    timeframe: str = "1h",
    funding_rates: pd.DataFrame | None = None,
    max_hold_bars: int = 96,
) -> BacktestResult:
    """
    Run a single backtest of a strategy with a given parameter set.

    Execution model:
    - Signals computed on bar N close
    - Entry executed at bar N+ENTRY_DELAY_BARS open (no lookahead)
    - Exit executed at bar N+EXIT_DELAY_BARS open (for SL/TP signals)
    - Fees: TAKER_FEE on entry + TAKER_FEE on exit
    - Slippage: SLIPPAGE on entry + SLIPPAGE on exit
    - Max 1 open position at a time (Phase 0)

    Returns:
        BacktestResult with all trades and computed metrics
    """
    log.info(
        "Starting backtest",
        strategy_id=strategy.strategy_id,
        symbol=symbol,
        bars=len(candles),
        params=params,
    )

    candles = candles.copy().reset_index(drop=True)

    # Generate signals (on close prices — no lookahead)
    signals_df = strategy.generate_signals(candles, params, funding_rates)

    trades: list[Trade] = []
    equity = initial_equity
    equity_curve: list[float] = [equity] * len(candles)

    open_trade: dict | None = None
    bars_in_trade = 0

    entry_delay = cfg.ENTRY_DELAY_BARS
    exit_delay = cfg.EXIT_DELAY_BARS

    for bar_idx in range(len(candles)):
        row = candles.iloc[bar_idx]
        sig_row = signals_df.iloc[bar_idx]

        # --- Check exit conditions for open trade ---
        if open_trade is not None:
            bars_in_trade += 1
            current_high = row["high"]
            current_low = row["low"]
            current_open = row["open"]
            sl = open_trade["stop_loss_price"]
            tp = open_trade["take_profit_price"]
            side = open_trade["side"]

            exit_price: float | None = None
            exit_reason = ""

            # Check stop loss and take profit (use open of bar for next-bar exit)
            if side == "long":
                if current_low <= sl:
                    exit_price = sl
                    exit_reason = "stop_loss"
                elif current_high >= tp:
                    exit_price = tp
                    exit_reason = "take_profit"
            else:  # short
                if current_high >= sl:
                    exit_price = sl
                    exit_reason = "stop_loss"
                elif current_low <= tp:
                    exit_price = tp
                    exit_reason = "take_profit"

            # Time-based exit
            if exit_price is None and bars_in_trade >= max_hold_bars:
                exit_price = current_open
                exit_reason = "time_exit"

            # Signal reversal or flat exit
            if exit_price is None and int(sig_row["signal"]) != 0:
                new_side = "long" if int(sig_row["signal"]) == 1 else "short"
                if new_side != side:
                    exit_price = current_open
                    exit_reason = "signal_exit"

            if exit_price is not None:
                trade = _close_trade(open_trade, exit_price, exit_reason, bar_idx, row["timestamp"])
                equity += trade.net_pnl_usd
                trades.append(trade)
                open_trade = None
                bars_in_trade = 0

        equity_curve[bar_idx] = equity

        # --- Open new trade if signal and no position ---
        if open_trade is None and bar_idx + entry_delay < len(candles):
            signal = int(sig_row["signal"])
            if signal != 0:
                entry_bar_idx = bar_idx + entry_delay
                entry_row = candles.iloc[entry_bar_idx]
                entry_price = float(entry_row["open"])

                # Apply slippage to entry
                if signal == 1:  # long
                    entry_price *= (1 + cfg.SLIPPAGE)
                else:            # short
                    entry_price *= (1 - cfg.SLIPPAGE)

                sl_price = float(sig_row["stop_loss_price"])
                tp_price = float(sig_row["take_profit_price"])
                risk_pct = float(sig_row.get("position_size_pct", cfg.MAX_RISK_PER_TRADE))

                # Position sizing
                sl_distance = abs(entry_price - sl_price) / entry_price
                if sl_distance <= 0:
                    continue  # Invalid signal — skip

                risk_amount = equity * risk_pct
                position_size = risk_amount / (sl_distance * entry_price)  # In base units

                # Leverage check
                notional = position_size * entry_price
                leverage = notional / equity
                if leverage > cfg.MAX_LEVERAGE:
                    # Cap position size at max leverage
                    position_size = (equity * cfg.MAX_LEVERAGE) / entry_price

                # Entry fee
                entry_fee = position_size * entry_price * cfg.TAKER_FEE

                open_trade = {
                    "id": str(uuid.uuid4()),
                    "strategy_id": strategy.strategy_id,
                    "symbol": symbol,
                    "side": "long" if signal == 1 else "short",
                    "entry_bar": entry_bar_idx,
                    "entry_price": entry_price,
                    "stop_loss_price": sl_price,
                    "take_profit_price": tp_price,
                    "position_size": position_size,
                    "entry_fee": entry_fee,
                    "initial_risk_usd": risk_amount,
                    "entry_time": entry_row["timestamp"],
                    "indicators": {k: float(v) for k, v in sig_row.items()
                                   if k not in ("signal", "stop_loss_price",
                                                "take_profit_price", "position_size_pct",
                                                "signal_reason")
                                   and isinstance(v, (int, float))},
                }

    # Close any open trade at end of data
    if open_trade is not None:
        last_row = candles.iloc[-1]
        trade = _close_trade(open_trade, float(last_row["close"]), "data_end", len(candles) - 1, last_row["timestamp"])
        equity += trade.net_pnl_usd
        trades.append(trade)
        equity_curve[-1] = equity

    result = BacktestResult(
        strategy_id=strategy.strategy_id,
        symbol=symbol,
        timeframe=timeframe,
        data_segment=data_segment,
        params=params,
        trades=trades,
        equity_curve=equity_curve,
        data_start=candles.iloc[0]["timestamp"],
        data_end=candles.iloc[-1]["timestamp"],
    )

    compute_metrics(result, initial_equity)

    log.info(
        "Backtest complete",
        strategy_id=strategy.strategy_id,
        total_trades=result.total_trades,
        net_pnl_usd=round(result.net_pnl_usd, 2),
        max_drawdown_pct=round(result.max_drawdown_pct, 4),
        sharpe=round(result.sharpe_ratio, 3),
        fee_viable=result.fee_viability_pass,
    )

    return result


def _close_trade(
    open_trade: dict,
    exit_price: float,
    exit_reason: str,
    exit_bar: int,
    exit_time: datetime,
) -> Trade:
    """Calculate and close a trade."""
    side = open_trade["side"]
    entry_price = open_trade["entry_price"]
    position_size = open_trade["position_size"]

    # Apply slippage to exit
    if side == "long":
        exit_price_slipped = exit_price * (1 - cfg.SLIPPAGE)
    else:
        exit_price_slipped = exit_price * (1 + cfg.SLIPPAGE)

    # P&L
    if side == "long":
        gross_pnl = (exit_price_slipped - entry_price) * position_size
    else:
        gross_pnl = (entry_price - exit_price_slipped) * position_size

    exit_fee = position_size * exit_price * cfg.TAKER_FEE
    slippage_cost = position_size * abs(exit_price - exit_price_slipped)
    total_fees = open_trade["entry_fee"] + exit_fee
    net_pnl = gross_pnl - total_fees

    initial_risk = open_trade["initial_risk_usd"]
    r_multiple = net_pnl / initial_risk if initial_risk > 0 else 0.0

    holding_bars = exit_bar - open_trade["entry_bar"]

    return Trade(
        id=open_trade["id"],
        strategy_id=open_trade["strategy_id"],
        symbol=open_trade["symbol"],
        side=side,
        entry_bar=open_trade["entry_bar"],
        exit_bar=exit_bar,
        entry_price=entry_price,
        exit_price=exit_price_slipped,
        stop_loss_price=open_trade["stop_loss_price"],
        take_profit_price=open_trade["take_profit_price"],
        position_size=position_size,
        gross_pnl_usd=gross_pnl,
        fees_paid_usd=total_fees,
        slippage_cost_usd=slippage_cost,
        net_pnl_usd=net_pnl,
        net_pnl_pct=net_pnl / (position_size * entry_price) if position_size > 0 else 0.0,
        r_multiple=r_multiple,
        holding_bars=holding_bars,
        exit_reason=exit_reason,
        entry_time=open_trade["entry_time"],
        exit_time=exit_time,
        initial_risk_usd=initial_risk,
        indicators_at_entry=open_trade.get("indicators", {}),
    )


# ============================================================================
# Metrics computation — all 20+ metrics from Section 8.3
# ============================================================================

def compute_metrics(result: BacktestResult, initial_equity: float) -> None:
    """Compute all metrics and populate the BacktestResult in-place."""
    trades = result.trades
    equity_curve = np.array(result.equity_curve)

    if not trades:
        log.warning("No trades in backtest — all metrics will be zero")
        return

    # --- Basic P&L ---
    pnls = np.array([t.net_pnl_usd for t in trades])
    result.total_trades = len(trades)
    result.long_trades = sum(1 for t in trades if t.side == "long")
    result.short_trades = sum(1 for t in trades if t.side == "short")
    result.net_pnl_usd = float(pnls.sum())
    result.total_return_pct = result.net_pnl_usd / initial_equity * 100

    # --- Fee viability check (Section 3.4) ---
    gross_pnls = np.array([t.gross_pnl_usd for t in trades])
    notionals = np.array([t.position_size * t.entry_price for t in trades])
    avg_gross_edge_pct = float((gross_pnls / notionals).mean()) if notionals.sum() > 0 else 0.0
    result.avg_gross_edge_pct = avg_gross_edge_pct
    result.round_trip_cost_pct = cfg.round_trip_cost()
    result.fee_viability_pass = avg_gross_edge_pct >= cfg.fee_viability_threshold()

    if not result.fee_viability_pass:
        log.warning(
            "Fee viability check FAILED",
            avg_gross_edge_pct=round(avg_gross_edge_pct * 100, 4),
            required_pct=round(cfg.fee_viability_threshold() * 100, 4),
        )

    # --- Win/Loss stats ---
    wins = pnls[pnls > 0]
    losses = pnls[pnls <= 0]
    result.win_rate_pct = (len(wins) / len(pnls)) * 100
    result.avg_win_usd = float(wins.mean()) if len(wins) > 0 else 0.0
    result.avg_loss_usd = float(losses.mean()) if len(losses) > 0 else 0.0
    result.best_trade_usd = float(pnls.max())
    result.worst_trade_usd = float(pnls.min())
    result.expectancy_usd = float(pnls.mean())

    # Profit factor
    total_wins = float(wins.sum()) if len(wins) > 0 else 0.0
    total_losses = float(abs(losses.sum())) if len(losses) > 0 else 0.0
    result.profit_factor = total_wins / total_losses if total_losses > 0 else float("inf")

    # --- Drawdown ---
    peak = np.maximum.accumulate(equity_curve)
    drawdown = (equity_curve - peak) / peak
    result.max_drawdown_pct = float(abs(drawdown.min()) * 100)

    # --- CAGR ---
    n_days = (result.data_end - result.data_start).days
    if n_days > 0:
        years = n_days / 365.25
        final_equity = initial_equity + result.net_pnl_usd
        result.cagr_pct = ((final_equity / initial_equity) ** (1 / years) - 1) * 100
    else:
        result.cagr_pct = 0.0

    # --- Sharpe & Sortino (annualized, using trade returns) ---
    trade_returns = pnls / initial_equity
    if len(trade_returns) > 1:
        avg_return = trade_returns.mean()
        std_return = trade_returns.std(ddof=1)
        downside = trade_returns[trade_returns < 0]
        downside_std = downside.std(ddof=1) if len(downside) > 1 else 0.0

        # Annualize assuming ~252 trading days, ~5 trades/day → scale by sqrt(252*5) = ~35.5
        # For lower frequency, use actual trade count → sqrt(annual_trades)
        annual_trades = len(trades) / (n_days / 365.25) if n_days > 0 else len(trades)
        ann_factor = np.sqrt(annual_trades)

        result.sharpe_ratio = (avg_return / std_return * ann_factor) if std_return > 0 else 0.0
        result.sortino_ratio = (avg_return / downside_std * ann_factor) if downside_std > 0 else 0.0
    else:
        result.sharpe_ratio = 0.0
        result.sortino_ratio = 0.0

    result.calmar_ratio = (result.cagr_pct / result.max_drawdown_pct
                           if result.max_drawdown_pct > 0 else 0.0)

    # --- Consecutive wins/losses ---
    win_flags = [1 if p > 0 else 0 for p in pnls]
    result.max_consec_wins = _max_consecutive(win_flags, 1)
    result.max_consec_losses = _max_consecutive(win_flags, 0)

    # --- Exposure & holding ---
    total_bars = len(equity_curve)
    in_trade_bars = sum(t.holding_bars for t in trades)
    result.exposure_time_pct = (in_trade_bars / total_bars * 100) if total_bars > 0 else 0.0
    result.avg_hold_bars = float(np.mean([t.holding_bars for t in trades]))

    # --- Fees ---
    result.fees_paid_usd = float(sum(t.fees_paid_usd for t in trades))
    result.slippage_cost_usd = float(sum(t.slippage_cost_usd for t in trades))


def _max_consecutive(flags: list[int], target: int) -> int:
    """Count maximum consecutive occurrences of target in flags."""
    max_count = 0
    count = 0
    for f in flags:
        if f == target:
            count += 1
            max_count = max(max_count, count)
        else:
            count = 0
    return max_count
