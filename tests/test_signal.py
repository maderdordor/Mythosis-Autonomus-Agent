import os
import sys
from pathlib import Path
from dotenv import load_dotenv
import pandas as pd
from supabase import create_client

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

from engine.strategies.strategy_001 import FundingRateReversalStrategy
from engine.backtest.engine import run_backtest

supa = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
sym = "DOGEUSDT"
cdf = pd.DataFrame(supa.table("ohlcv_candles").select("*").eq("symbol", sym).eq("timeframe", "1h").execute().data)
cdf["timestamp"] = pd.to_datetime(cdf["timestamp"])
for col in ["open", "high", "low", "close", "volume"]: cdf[col] = cdf[col].astype(float)
cdf = cdf.sort_values("timestamp").reset_index(drop=True)

fdf = pd.DataFrame(supa.table("funding_rates").select("*").eq("symbol", sym).execute().data)
fdf["timestamp"] = pd.to_datetime(fdf["timestamp"])
fdf["funding_rate"] = fdf["funding_rate"].astype(float)

strat = FundingRateReversalStrategy()
params = {'funding_threshold': 0.0001, 'funding_persistence_intervals': 1, 'ema_period': 10, 'rsi_period': 14, 'rsi_threshold_long': 50, 'rsi_threshold_short': 50, 'atr_sl_multiplier': 1.5}
res = run_backtest(strat, cdf, params, 200, "in_sample", sym, "1h", fdf)
print(f"Trades for {sym}: {res.total_trades}")
