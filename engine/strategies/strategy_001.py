"""
engine/strategies/strategy_001.py
Strategy 001: Funding Rate Extreme Reversal.
"""

from __future__ import annotations
from typing import Any
import numpy as np
import pandas as pd
import structlog

from engine.backtest.engine import BacktestStrategy
from engine.strategies.indicators import calc_ema, calc_rsi, calc_atr, calc_sma

log = structlog.get_logger(__name__)


class FundingRateReversalStrategy(BacktestStrategy):
    strategy_id = "001_funding_rate_reversal"

    def generate_signals(
        self,
        candles: pd.DataFrame,
        params: dict[str, Any],
        funding_rates: pd.DataFrame | None = None,
    ) -> pd.DataFrame:
        """
        Generate signals for Strategy 001 based on 1h candles.
        """
        df = pd.DataFrame(index=candles.index)
        df["timestamp"] = candles["timestamp"]
        
        # Unpack parameters
        funding_threshold = params.get("funding_threshold", 0.001)  # 0.1%
        funding_persistence_intervals = params.get("funding_persistence_intervals", 2)
        ema_period = int(params.get("ema_period", 20))
        rsi_period = int(params.get("rsi_period", 14))
        rsi_threshold_long = params.get("rsi_threshold_long", 45)
        rsi_threshold_short = params.get("rsi_threshold_short", 55)
        atr_sl_multiplier = params.get("atr_sl_multiplier", 1.5)
        
        # Calculate indicators
        close = candles["close"]
        high = candles["high"]
        low = candles["low"]
        volume = candles["volume"]
        
        ema = calc_ema(close, ema_period)
        rsi = calc_rsi(close, rsi_period)
        atr = calc_atr(high, low, close, 14)
        vol_ma = calc_sma(volume, 20)
        
        df["ema"] = ema
        df["rsi"] = rsi
        df["atr"] = atr
        df["vol_ma"] = vol_ma
        
        # Map funding rates to candles
        if funding_rates is not None and not funding_rates.empty:
            # Sort funding rates
            fr = funding_rates.sort_values("timestamp")
            
            # Use merge_asof to align the latest funding rate available at or before the candle time
            # Candles timestamp is usually the open of the bar, we want the funding rate known at that time.
            df = pd.merge_asof(
                df, 
                fr[["timestamp", "funding_rate"]], 
                on="timestamp", 
                direction="backward"
            )
            df["funding_rate"] = df["funding_rate"].ffill().fillna(0.0)
        else:
            log.warning("No funding rate data provided to Strategy 001")
            df["funding_rate"] = 0.0
            
        # Check funding persistence
        # Since funding is every 8h, checking the past N intervals means checking if the condition
        # held for the last N*8 hours. But since we use merge_asof on 1h candles, the funding_rate 
        # stays constant for 8 hours. 
        # A simple way to check persistence of N intervals is to look back N*8 bars.
        lookback_bars = funding_persistence_intervals * 8
        
        # Condition: extreme negative funding (<= -threshold) for `lookback_bars`
        extreme_neg = df["funding_rate"] <= -funding_threshold
        # Rolling min of the boolean series over lookback_bars: if min == 1, all were true
        persistent_extreme_neg = extreme_neg.rolling(window=lookback_bars, min_periods=lookback_bars).min() == 1
        
        # Condition: extreme positive funding (>= threshold) for `lookback_bars`
        extreme_pos = df["funding_rate"] >= funding_threshold
        persistent_extreme_pos = extreme_pos.rolling(window=lookback_bars, min_periods=lookback_bars).min() == 1
        
        # Long Entry Conditions:
        # 1. Persistent extreme negative funding
        # 2. Price < EMA
        # 3. RSI < rsi_threshold_long
        # 4. Volume >= Vol MA
        cond_long = (
            persistent_extreme_neg &
            (close < ema) &
            (rsi < rsi_threshold_long) &
            (volume >= vol_ma)
        )
        
        # Short Entry Conditions:
        # 1. Persistent extreme positive funding
        # 2. Price > EMA
        # 3. RSI > rsi_threshold_short
        # 4. Volume >= Vol MA
        cond_short = (
            persistent_extreme_pos &
            (close > ema) &
            (rsi > rsi_threshold_short) &
            (volume >= vol_ma)
        )
        
        # Note: 4h trend filter is omitted here for simplicity in MVP, but can be added 
        # by resampling the dataframe to 4h and calculating 4h EMA/RSI, then merge_asof back.
        
        # Assign signals
        df["signal"] = 0
        df.loc[cond_long, "signal"] = 1
        df.loc[cond_short, "signal"] = -1
        
        # Calculate Stop Loss and Take Profit
        # Hard maximum 2% stop distance per thesis
        max_sl_dist = 0.02
        
        atr_dist_long = (atr * atr_sl_multiplier) / close
        atr_dist_short = (atr * atr_sl_multiplier) / close
        
        # Clip SL distance to 2% max
        sl_dist_long_clipped = np.clip(atr_dist_long, 0.0, max_sl_dist)
        sl_dist_short_clipped = np.clip(atr_dist_short, 0.0, max_sl_dist)
        
        df["stop_loss_price"] = 0.0
        df["take_profit_price"] = 0.0
        
        # For longs:
        # SL = Close * (1 - SL_dist)
        # TP = Close * (1 + SL_dist * 1.8)  # 1.8R hard target
        df.loc[cond_long, "stop_loss_price"] = close[cond_long] * (1 - sl_dist_long_clipped[cond_long])
        df.loc[cond_long, "take_profit_price"] = close[cond_long] * (1 + sl_dist_long_clipped[cond_long] * 1.8)
        
        # For shorts:
        # SL = Close * (1 + SL_dist)
        # TP = Close * (1 - SL_dist * 1.8)
        df.loc[cond_short, "stop_loss_price"] = close[cond_short] * (1 + sl_dist_short_clipped[cond_short])
        df.loc[cond_short, "take_profit_price"] = close[cond_short] * (1 - sl_dist_short_clipped[cond_short] * 1.8)
        
        # The backtest engine expects position_size_pct (fraction of equity to risk)
        df["position_size_pct"] = 0.005  # 0.5% risk per trade per thesis
        
        df["signal_reason"] = "Funding Extreme Reversal Setup"
        
        return df
