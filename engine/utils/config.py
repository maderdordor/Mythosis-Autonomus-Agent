"""
engine/utils/config.py
Load environment configuration for Python engine.
Reads from .env file in project root.
"""

from __future__ import annotations

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from project root (two levels up from engine/utils/)
_root = Path(__file__).parent.parent.parent
load_dotenv(_root / ".env")


def _float(key: str, default: float) -> float:
    return float(os.environ.get(key, str(default)))


def _int(key: str, default: int) -> int:
    return int(os.environ.get(key, str(default)))


def _bool(key: str, default: bool) -> bool:
    return os.environ.get(key, str(default)).lower() == "true"


def _str(key: str, default: str = "") -> str:
    return os.environ.get(key, default)


class Config:
    # Database
    DATABASE_URL: str = _str("DATABASE_URL")
    SUPABASE_URL: str = _str("SUPABASE_URL")
    SUPABASE_SERVICE_ROLE_KEY: str = _str("SUPABASE_SERVICE_ROLE_KEY")

    # Execution realism (Section 8.4)
    MAKER_FEE: float = _float("MAKER_FEE", 0.0002)
    TAKER_FEE: float = _float("TAKER_FEE", 0.00055)
    SLIPPAGE: float = _float("SLIPPAGE", 0.0005)
    ENTRY_DELAY_BARS: int = _int("ENTRY_DELAY_BARS", 1)
    EXIT_DELAY_BARS: int = _int("EXIT_DELAY_BARS", 1)
    FEE_VIABILITY_MULTIPLIER: float = _float("FEE_VIABILITY_MULTIPLIER", 2.0)

    # Risk limits
    MAX_RISK_PER_TRADE: float = _float("MAX_RISK_PER_TRADE", 0.005)
    MAX_DAILY_LOSS: float = _float("MAX_DAILY_LOSS", 0.02)
    MAX_ACCOUNT_DRAWDOWN: float = _float("MAX_ACCOUNT_DRAWDOWN", 0.10)
    MAX_LEVERAGE: float = _float("MAX_LEVERAGE", 2.0)

    @classmethod
    def round_trip_cost(cls) -> float:
        """Full round-trip cost including fees and slippage on both sides."""
        return cls.TAKER_FEE * 2 + cls.SLIPPAGE * 2

    @classmethod
    def fee_viability_threshold(cls) -> float:
        """Minimum avg gross edge required per trade (Section 3.4)."""
        return cls.FEE_VIABILITY_MULTIPLIER * cls.round_trip_cost()


cfg = Config()
