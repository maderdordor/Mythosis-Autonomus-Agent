# Mythos Trading Agent

An autonomous crypto trading agent that executes trades 24/7 without per-trade human intervention once a strategy is promoted to live.

## Architecture

- **Core Agent** — TypeScript (Node.js 20+): agent orchestration, config, indicators, execution, Telegram
- **Research Engine** — Python 3.12 (uv): backtest, WFO, Monte Carlo, optimization, validation
- **Database** — Supabase (PostgreSQL): all operational + time-series data
- **Cache** — Upstash (managed Redis): TTL cache, rate limiting, job queues
- **Exchange** — ccxt (Bybit): OHLCV data + execution

## Build Status

**Current Phase: Phase 0 — Ruthless MVP (Completed)**

We have completed the structural scaffolding for Phase 0, including:
- Data fetchers (Bybit -> Supabase)
- Hybrid architecture (TypeScript orchestration, Python vectorized engine)
- The triple-lock validation engine (Walk-Forward Optimization, Monte Carlo Simulation, Overfit Risk Detection)
- Implementation of `Strategy 001: Funding Rate Extreme Reversal`

> Gate 1 (one strategy with PASS verdict) must be reached before Phase 1 begins.

## Quick Start & Testing

```bash
# Install TypeScript dependencies
pnpm install

# Install Python dependencies
uv pip install -e .
# (or if using standard pip: python3 -m pip install supabase python-dotenv pandas numpy)

# Copy and configure environment
cp .env.example .env
# Fill in: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
# Bybit keys are NOT required for fetching historical data (ensure BYBIT_TESTNET=false)

# Run Supabase migration
# → Open Supabase Dashboard → SQL Editor → paste supabase/migrations/001_initial_schema.sql → Run

# 1. Fetch OHLCV data & Funding Rates (TypeScript)
pnpm tsx tests/dummy_fetch.ts

# 2. Run backtest (Python Engine)
python3 tests/dummy_backtest.py
```

## Project Identity Rule (from brief)

Mythos is a trading system first. It is not a token project, not a CT showcase, and not a dashboard product until it has proven live profitability.

- Build priority always favors boring validation work over visible features.
- Web UI, public dashboards, marketing pages, and any token/narrative decisions are **deferred until after Gate 3**.
- When incentives conflict, the trading system wins. **Always.**

## Phases

| Phase | Status | Gate |
|---|---|---|
| Phase 0 — Ruthless MVP | 🔨 **In Progress** | Gate 1: 1 strategy PASS |
| Phase 1 — Paper + Control | ⏳ Locked | Gate 2: Paper proof |
| Phase 2 — Live MANUAL | ⏳ Locked | Gate 3: 100+ trades, positive EV |
| Phase 3 — Autonomy + Scale | ⏳ Locked | — |

## Documentation

- [Agent Instructions](docs/agent_instructions.md)
- [Strategy Template + Edge Thesis](docs/strategy_template.md)
- [Validation Rules](docs/validation_rules.md)
- [Overfitting Policy](docs/overfitting_policy.md)
- [Live Trading Policy](docs/live_trading_policy.md)
- [Risk Policy](docs/risk_policy.md)
- [Nansen Policy — Lookahead Bias Warning](docs/nansen_policy.md)
