# Mythos Trading Agent

An autonomous crypto trading agent that executes trades 24/7 without per-trade human intervention once a strategy is promoted to live.

## Architecture

- **Core Agent** — TypeScript (Node.js 20+): agent orchestration, config, indicators, execution, Telegram
- **Research Engine** — Python 3.12 (uv): backtest, WFO, Monte Carlo, optimization, validation
- **Database** — Supabase (PostgreSQL): all operational + time-series data
- **Cache** — Upstash (managed Redis): TTL cache, rate limiting, job queues
- **Exchange** — ccxt (Bybit): OHLCV data + execution

## Build Status

**Current Phase: Phase 0 — Ruthless MVP**

Nothing is live. Building the validation pipeline first.

> Gate 1 (one strategy with PASS verdict) must be reached before Phase 1 begins.

## Quick Start

```bash
# Install TypeScript dependencies
pnpm install

# Install Python dependencies
uv sync

# Copy and configure environment
cp .env.example .env
# Fill in: SUPABASE_URL, SUPABASE_ANON_KEY, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
# Bybit keys are optional in Phase 0 (public OHLCV endpoints used)

# Run Supabase migration
# → Open Supabase Dashboard → SQL Editor → paste supabase/migrations/001_initial_schema.sql → Run

# Fetch OHLCV data
pnpm run data:fetch

# Run backtest (Python engine)
uv run python -m engine.backtest.engine --strategy strategy_001 --symbol SOLUSDT --timeframe 1h
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
