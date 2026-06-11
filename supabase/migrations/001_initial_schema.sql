-- ==============================================================================
-- Mythos Trading Agent — Supabase Database Schema
-- Migration: 001_initial_schema.sql
-- ==============================================================================
-- HOW TO RUN:
--   1. Open Supabase Dashboard → your project
--   2. Go to SQL Editor → New Query
--   3. Paste this entire file → click Run
-- ==============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- SYSTEM CONFIG
-- Stores agent-level configuration and state flags
-- ==============================================================================
CREATE TABLE IF NOT EXISTS system_config (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  description TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Seed critical config values
INSERT INTO system_config (key, value, description) VALUES
  ('decision_mode',                    'hardcoded',    'Current decision mode: hardcoded | llm_advisory | llm_active'),
  ('live_trading',                     'false',        'Master live trading switch'),
  ('paper_trading',                    'false',        'Paper trading switch'),
  ('execution_mode',                   'manual',       'Execution autonomy: manual | semi_auto | full_auto'),
  ('kill_switch_active',               'false',        'Global kill switch state'),
  ('phase',                            '0',            'Current build phase (0, 1, 2, 3)'),
  ('nansen_snapshot_collector_start',  '',             'ISO timestamp when Nansen collector started — critical for lookahead bias prevention'),
  ('daily_loss_used_pct',              '0',            'Today UTC daily loss used as % of equity'),
  ('weekly_loss_used_pct',             '0',            'This week UTC weekly loss used as % of equity')
ON CONFLICT (key) DO NOTHING;

-- ==============================================================================
-- OHLCV CANDLES
-- Primary market data table — all historical price data
-- ==============================================================================
CREATE TABLE IF NOT EXISTS ohlcv_candles (
  exchange      TEXT          NOT NULL,    -- 'bybit'
  symbol        TEXT          NOT NULL,    -- 'SOLUSDT'
  timeframe     TEXT          NOT NULL,    -- '1h', '4h', '1d'
  market_type   TEXT          NOT NULL,    -- 'spot' | 'perp'
  timestamp     TIMESTAMPTZ   NOT NULL,
  open          NUMERIC(20,8) NOT NULL,
  high          NUMERIC(20,8) NOT NULL,
  low           NUMERIC(20,8) NOT NULL,
  close         NUMERIC(20,8) NOT NULL,
  volume        NUMERIC(30,8) NOT NULL,
  created_at    TIMESTAMPTZ   DEFAULT NOW(),

  PRIMARY KEY (exchange, symbol, timeframe, market_type, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_ohlcv_lookup
  ON ohlcv_candles (symbol, timeframe, market_type, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_ohlcv_recent
  ON ohlcv_candles (exchange, symbol, timeframe, timestamp DESC);

-- ==============================================================================
-- FUNDING RATES
-- Separate table for 8h funding rate history (required for Strategy 001)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS funding_rates (
  exchange      TEXT          NOT NULL,    -- 'bybit'
  symbol        TEXT          NOT NULL,    -- 'SOLUSDT'
  timestamp     TIMESTAMPTZ   NOT NULL,    -- 8h interval timestamp
  funding_rate  NUMERIC(12,8) NOT NULL,   -- e.g. 0.0001 = 0.01%
  created_at    TIMESTAMPTZ   DEFAULT NOW(),

  PRIMARY KEY (exchange, symbol, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_funding_rates_lookup
  ON funding_rates (symbol, timestamp DESC);

-- ==============================================================================
-- DATA INTEGRITY LOG
-- Tracks data fetch operations, gap detections, and integrity checks
-- ==============================================================================
CREATE TABLE IF NOT EXISTS data_integrity_log (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  exchange      TEXT          NOT NULL,
  symbol        TEXT          NOT NULL,
  timeframe     TEXT          NOT NULL,
  market_type   TEXT          NOT NULL,
  check_type    TEXT          NOT NULL,   -- 'fetch' | 'gap_detection' | 'dedup' | 'integrity'
  status        TEXT          NOT NULL,   -- 'ok' | 'warning' | 'error'
  details       JSONB,
  candles_found INTEGER,
  candles_added INTEGER,
  gaps_detected INTEGER,
  created_at    TIMESTAMPTZ   DEFAULT NOW()
);

-- ==============================================================================
-- STRATEGIES
-- Registry of all strategies in the system
-- ==============================================================================
CREATE TABLE IF NOT EXISTS strategies (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT        UNIQUE NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'sandbox',
                        -- sandbox | validated | rejected | live_ready
  execution_mode        TEXT        NOT NULL DEFAULT 'manual',
                        -- manual | semi_auto | full_auto
  decision_mode         TEXT        NOT NULL DEFAULT 'hardcoded',
                        -- hardcoded | llm_advisory | llm_active
  edge_thesis           TEXT        NOT NULL,  -- Cannot be empty
  symbols               JSONB       NOT NULL,  -- ["SOLUSDT"]
  timeframes            JSONB       NOT NULL,  -- ["1h", "4h"]
  market_type           TEXT        NOT NULL,  -- 'spot' | 'perp'
  params                JSONB,                 -- Current live params
  param_search_space    JSONB,                 -- Optimization search space
  known_weaknesses      JSONB,
  market_regime         TEXT,                  -- Designed market regime
  is_active             BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT edge_thesis_not_empty CHECK (length(trim(edge_thesis)) > 50)
);

-- ==============================================================================
-- BACKTEST RUNS
-- Every backtest execution is logged here with full metrics
-- ==============================================================================
CREATE TABLE IF NOT EXISTS backtest_runs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id       UUID        NOT NULL REFERENCES strategies(id),
  params            JSONB       NOT NULL,    -- Parameter set used
  symbol            TEXT        NOT NULL,
  timeframe         TEXT        NOT NULL,
  data_start        TIMESTAMPTZ NOT NULL,
  data_end          TIMESTAMPTZ NOT NULL,
  data_segment      TEXT        NOT NULL,    -- 'full' | 'in_sample' | 'out_sample' | 'holdout'

  -- Core metrics (Section 8.3)
  total_return_pct  NUMERIC(10,4),
  net_pnl_usd       NUMERIC(15,4),
  cagr_pct          NUMERIC(10,4),
  max_drawdown_pct  NUMERIC(10,4),
  sharpe_ratio      NUMERIC(8,4),
  sortino_ratio     NUMERIC(8,4),
  calmar_ratio      NUMERIC(8,4),
  profit_factor     NUMERIC(8,4),
  win_rate_pct      NUMERIC(8,4),
  expectancy_usd    NUMERIC(10,4),
  avg_win_usd       NUMERIC(10,4),
  avg_loss_usd      NUMERIC(10,4),
  best_trade_usd    NUMERIC(10,4),
  worst_trade_usd   NUMERIC(10,4),
  total_trades      INTEGER,
  long_trades       INTEGER,
  short_trades      INTEGER,
  exposure_time_pct NUMERIC(8,4),
  max_consec_wins   INTEGER,
  max_consec_losses INTEGER,
  avg_hold_bars     NUMERIC(8,2),
  fees_paid_usd     NUMERIC(12,4),
  slippage_cost_usd NUMERIC(12,4),

  -- Fee viability check (Section 3.4)
  avg_gross_edge_pct  NUMERIC(8,4),
  round_trip_cost_pct NUMERIC(8,4),
  fee_viability_pass  BOOLEAN,

  -- Full outputs
  trade_log         JSONB,         -- Array of individual trades
  equity_curve      JSONB,         -- Equity at each timestamp
  metrics_raw       JSONB,         -- Full metrics JSON

  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backtest_strategy
  ON backtest_runs (strategy_id, created_at DESC);

-- ==============================================================================
-- OPTIMIZATION RUNS
-- Parameter search results — robust zones, not single best points
-- ==============================================================================
CREATE TABLE IF NOT EXISTS optimization_runs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id       UUID        NOT NULL REFERENCES strategies(id),
  method            TEXT        NOT NULL,   -- 'grid' | 'random' | 'bayesian'
  symbol            TEXT        NOT NULL,
  timeframe         TEXT        NOT NULL,
  search_space      JSONB       NOT NULL,
  total_combinations INTEGER,
  combinations_tested INTEGER,

  -- Results
  best_params           JSONB,
  robust_zone_params    JSONB,   -- Cluster of high-performing nearby params
  flat_region_score     NUMERIC(5,4),
  parameter_heatmap     JSONB,  -- Stored for visualization
  rejected_reason       TEXT,   -- If the optimization was rejected

  verdict               TEXT,   -- 'robust_zone_found' | 'isolated_peak' | 'no_edge'
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- WFO RUNS
-- Walk-Forward Optimization results
-- ==============================================================================
CREATE TABLE IF NOT EXISTS wfo_runs (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id           UUID        NOT NULL REFERENCES strategies(id),
  optimization_run_id   UUID        REFERENCES optimization_runs(id),
  symbol                TEXT        NOT NULL,
  timeframe             TEXT        NOT NULL,
  window_count          INTEGER     NOT NULL,
  in_sample_bars        INTEGER     NOT NULL,
  out_sample_bars       INTEGER     NOT NULL,

  -- Per-window results
  windows               JSONB       NOT NULL,  -- Array of {window_id, IS metrics, OOS metrics, params}

  -- Aggregate metrics
  profitable_windows_pct  NUMERIC(5,4),
  mean_oos_sharpe         NUMERIC(8,4),
  oos_sharpe_cv           NUMERIC(8,4),   -- Coefficient of variation
  flat_region_score       NUMERIC(5,4),
  parameter_stable        BOOLEAN,
  single_window_dominance BOOLEAN,        -- True if one window > 50% of profit

  -- Pass criteria results
  profitable_windows_pass BOOLEAN,
  mean_oos_sharpe_pass    BOOLEAN,
  cv_pass                 BOOLEAN,
  flat_region_pass        BOOLEAN,

  verdict               TEXT        NOT NULL,   -- 'PASS' | 'MARGINAL' | 'FAIL'
  verdict_reasons       JSONB,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- MONTE CARLO RUNS
-- Monte Carlo stress test results
-- ==============================================================================
CREATE TABLE IF NOT EXISTS monte_carlo_runs (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id         UUID        NOT NULL REFERENCES strategies(id),
  backtest_run_id     UUID        REFERENCES backtest_runs(id),
  simulation_count    INTEGER     NOT NULL,    -- Should be >= 10000
  methods_used        JSONB,                   -- Array of methods applied

  -- Key statistics
  risk_of_ruin        NUMERIC(5,4) NOT NULL,   -- Should be 0.00
  profitable_pct      NUMERIC(5,4) NOT NULL,   -- Should be >= 0.80
  worst_drawdown_pct  NUMERIC(8,4) NOT NULL,
  p5_return_pct       NUMERIC(10,4),           -- 5th percentile return
  p25_return_pct      NUMERIC(10,4),
  p50_return_pct      NUMERIC(10,4),           -- Median
  p75_return_pct      NUMERIC(10,4),
  p95_return_pct      NUMERIC(10,4),
  mean_return_pct     NUMERIC(10,4),

  -- Raw distribution (sampled for storage)
  return_distribution JSONB,

  -- Pass criteria
  ruin_pass           BOOLEAN,
  profitable_pass     BOOLEAN,
  drawdown_pass       BOOLEAN,
  p5_pass             BOOLEAN,

  verdict             TEXT        NOT NULL,    -- 'PASS' | 'FAIL'
  verdict_reasons     JSONB,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- HOLDOUT VALIDATION
-- Tracks holdout segment usage — enforces that holdout is never touched early
-- ==============================================================================
CREATE TABLE IF NOT EXISTS holdout_validation (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id         UUID        NOT NULL REFERENCES strategies(id) UNIQUE,
                                  -- One holdout record per strategy (prevents multiple peeks)
  holdout_start       TIMESTAMPTZ NOT NULL,
  holdout_end         TIMESTAMPTZ NOT NULL,
  locked_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- When segment was locked
  revealed_at         TIMESTAMPTZ,                         -- When holdout was first run

  -- Results (only populated after reveal)
  backtest_run_id     UUID        REFERENCES backtest_runs(id),
  total_return_pct    NUMERIC(10,4),
  sharpe_ratio        NUMERIC(8,4),
  max_drawdown_pct    NUMERIC(10,4),
  total_trades        INTEGER,
  expectancy_usd      NUMERIC(10,4),

  verdict             TEXT,        -- 'PASS' | 'FAIL' — only set after reveal
  verdict_reasons     JSONB,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- FINAL VERDICTS
-- Combines all validation components into final PASS/MARGINAL/FAIL
-- ==============================================================================
CREATE TABLE IF NOT EXISTS final_verdicts (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id         UUID        NOT NULL REFERENCES strategies(id),
  wfo_run_id          UUID        REFERENCES wfo_runs(id),
  mc_run_id           UUID        REFERENCES monte_carlo_runs(id),
  holdout_id          UUID        REFERENCES holdout_validation(id),

  -- Component verdicts
  wfo_verdict         TEXT,       -- 'PASS' | 'MARGINAL' | 'FAIL'
  mc_verdict          TEXT,       -- 'PASS' | 'FAIL'
  holdout_verdict     TEXT,       -- 'PASS' | 'FAIL'
  overfit_risk        TEXT,       -- 'LOW' | 'MEDIUM' | 'HIGH'
  fee_viability_pass  BOOLEAN,
  execution_realism   BOOLEAN,
  risk_policy_pass    BOOLEAN,

  -- Final
  verdict             TEXT        NOT NULL,   -- 'PASS' | 'MARGINAL' | 'FAIL'
  verdict_reasons     JSONB       NOT NULL,   -- Detailed explanation per component
  failed_components   JSONB,                  -- Which components failed and why

  -- Promotion tracking
  promoted_to_live    BOOLEAN     DEFAULT FALSE,
  promoted_at         TIMESTAMPTZ,
  promoted_by         TEXT,       -- User/system that approved promotion

  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- OVERFITTING DETECTOR LOG
-- Records all overfitting checks with individual factor scores
-- ==============================================================================
CREATE TABLE IF NOT EXISTS overfitting_checks (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  backtest_run_id         UUID        NOT NULL REFERENCES backtest_runs(id),
  strategy_id             UUID        NOT NULL REFERENCES strategies(id),

  -- Factor checks
  param_count             INTEGER,
  trades_per_param        NUMERIC(8,2),
  is_sharpe               NUMERIC(8,4),
  oos_to_is_sharpe_ratio  NUMERIC(5,4),
  single_trade_pct        NUMERIC(5,4),  -- Max single trade as % of total profit
  single_period_pct       NUMERIC(5,4),  -- Max single month as % of total profit
  param_sensitivity_drop  NUMERIC(5,4),  -- % performance drop for ±1 step param change

  -- Flags
  flag_high_param_count   BOOLEAN,
  flag_low_trades_ratio   BOOLEAN,
  flag_suspicious_sharpe  BOOLEAN,
  flag_is_oos_diverge     BOOLEAN,
  flag_single_trade_dep   BOOLEAN,
  flag_single_period_dep  BOOLEAN,
  flag_param_sensitivity  BOOLEAN,

  risk_level              TEXT        NOT NULL,  -- 'LOW' | 'MEDIUM' | 'HIGH'
  details                 JSONB,
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- NANSEN TOKEN SNAPSHOTS (Section 9.11)
-- Point-in-time snapshots collected from day 1 — critical for avoiding lookahead bias
-- ==============================================================================
CREATE TABLE IF NOT EXISTS nansen_token_snapshots (
  id                    BIGSERIAL   PRIMARY KEY,
  chain                 TEXT        NOT NULL,   -- 'solana' | 'ethereum' | etc.
  token_address         TEXT        NOT NULL,
  timestamp             TIMESTAMPTZ NOT NULL,   -- Snapshot time (point-in-time)
  smart_money_score     NUMERIC(5,2),
  netflow_score         NUMERIC(5,2),
  accumulation_score    NUMERIC(5,2),
  distribution_risk     NUMERIC(5,2),
  fund_flow_score       NUMERIC(5,2),
  smart_trader_flow_score NUMERIC(5,2),
  wallet_credibility_avg NUMERIC(5,2),
  wallet_count          INTEGER,
  raw_json_path         TEXT,                   -- Path to full raw JSON in Supabase Storage
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nansen_token_ts
  ON nansen_token_snapshots (token_address, timestamp DESC);

-- ==============================================================================
-- NANSEN WALLET SNAPSHOTS (Section 9.11)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS nansen_wallet_snapshots (
  id                BIGSERIAL   PRIMARY KEY,
  chain             TEXT        NOT NULL,
  wallet_address    TEXT        NOT NULL,
  labels_json       JSONB,
  credibility_score NUMERIC(5,2),
  realized_pnl      NUMERIC(20,4),
  win_rate          NUMERIC(5,4),
  trade_count       INTEGER,
  last_activity_at  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nansen_wallet_addr
  ON nansen_wallet_snapshots (wallet_address, created_at DESC);

-- ==============================================================================
-- NANSEN TRADE EVENTS (Section 9.11)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS nansen_trade_events (
  id                BIGSERIAL   PRIMARY KEY,
  chain             TEXT        NOT NULL,
  token_address     TEXT        NOT NULL,
  wallet_address    TEXT        NOT NULL,
  wallet_label      TEXT,
  side              TEXT        NOT NULL,   -- 'buy' | 'sell'
  amount_usd        NUMERIC(20,4),
  tx_hash           TEXT        UNIQUE,
  timestamp         TIMESTAMPTZ NOT NULL,
  credibility_score NUMERIC(5,2),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nansen_trades_token_ts
  ON nansen_trade_events (token_address, timestamp DESC);

-- ==============================================================================
-- NANSEN SIGNAL DECISIONS (Section 9.11)
-- Every Nansen-influenced signal decision is logged
-- ==============================================================================
CREATE TABLE IF NOT EXISTS nansen_signal_decisions (
  id                  BIGSERIAL   PRIMARY KEY,
  strategy_id         UUID        REFERENCES strategies(id),
  token_address       TEXT        NOT NULL,
  signal_type         TEXT,       -- From signal engine enum
  smart_money_score   NUMERIC(5,2),
  allowed             BOOLEAN     NOT NULL,
  reason              TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- COINGLASS SCANNER EVENTS (Section 10.6)
-- Store every scan event, including non-candidates (for forward-validation later)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS coinglass_scanner_events (
  id                      BIGSERIAL   PRIMARY KEY,
  symbol                  TEXT        NOT NULL,
  exchange_coverage       JSONB,
  timestamp               TIMESTAMPTZ NOT NULL,
  volume_spike_multiplier NUMERIC(8,4),
  oi_change_24h           NUMERIC(8,4),
  oi_confirmation         BOOLEAN,
  funding_rate            NUMERIC(12,8),
  funding_extreme         BOOLEAN,
  liquidation_cluster     TEXT,      -- 'shorts_below' | 'longs_above' | 'none'
  long_short_ratio        NUMERIC(8,4),
  scanner_score           NUMERIC(5,2),
  is_candidate            BOOLEAN     NOT NULL DEFAULT FALSE,
  candidate_reasons       JSONB,
  raw_json_path           TEXT,
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coinglass_symbol_ts
  ON coinglass_scanner_events (symbol, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_coinglass_candidates
  ON coinglass_scanner_events (is_candidate, timestamp DESC)
  WHERE is_candidate = TRUE;

-- ==============================================================================
-- TRADE LOGS (Phase 2+ — schema ready, not yet active)
-- Every live/paper trade is logged here
-- ==============================================================================
CREATE TABLE IF NOT EXISTS trade_logs (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id         UUID        NOT NULL REFERENCES strategies(id),
  symbol              TEXT        NOT NULL,
  market_type         TEXT        NOT NULL,   -- 'spot' | 'perp'
  exchange            TEXT        NOT NULL,
  side                TEXT        NOT NULL,   -- 'long' | 'short'
  execution_mode      TEXT        NOT NULL,   -- 'manual' | 'semi_auto' | 'full_auto'
  decision_mode       TEXT        NOT NULL,   -- 'hardcoded' | 'llm_advisory' | 'llm_active'

  -- Entry
  entry_price         NUMERIC(20,8),
  entry_time          TIMESTAMPTZ,
  entry_order_id      TEXT,
  position_size       NUMERIC(20,8),
  effective_leverage  NUMERIC(8,4),

  -- Exit
  exit_price          NUMERIC(20,8),
  exit_time           TIMESTAMPTZ,
  exit_order_id       TEXT,
  exit_reason         TEXT,       -- 'take_profit' | 'stop_loss' | 'strategy_exit' | 'time_exit' | 'manual' | 'kill_switch'

  -- P&L
  gross_pnl_usd       NUMERIC(15,4),
  fees_paid_usd       NUMERIC(12,4),
  net_pnl_usd         NUMERIC(15,4),
  net_pnl_pct         NUMERIC(10,4),
  r_multiple          NUMERIC(8,4),  -- Net PnL / initial risk

  -- Risk
  stop_loss_price     NUMERIC(20,8),
  take_profit_price   NUMERIC(20,8),
  initial_risk_usd    NUMERIC(12,4),
  initial_risk_pct    NUMERIC(8,4),

  -- Context at entry
  signal_data         JSONB,   -- Full signal that triggered the trade
  market_regime       TEXT,
  nansen_verdict      JSONB,   -- Nansen signal (if available)
  llm_verdict         JSONB,   -- LLM verdict (if LLM mode active)
  coinglass_snapshot  JSONB,   -- CoinGlass scanner state at entry

  -- Post-exit analysis
  re_entry_would_have_worked BOOLEAN,
  post_exit_notes     TEXT,
  holding_bars        INTEGER,

  is_paper            BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trade_logs_strategy
  ON trade_logs (strategy_id, entry_time DESC);

CREATE INDEX IF NOT EXISTS idx_trade_logs_recent
  ON trade_logs (entry_time DESC);

-- ==============================================================================
-- AGENT DECISIONS
-- Every agent decision is logged — for audit, comparison, and LLM evaluation
-- ==============================================================================
CREATE TABLE IF NOT EXISTS agent_decisions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id     UUID        REFERENCES strategies(id),
  decision_type   TEXT        NOT NULL,   -- 'entry_signal' | 'entry_blocked' | 'exit' | 'size_adjustment' | 'mode_switch'
  decision_mode   TEXT        NOT NULL,   -- Mode active at time of decision
  signal_data     JSONB,
  risk_check      JSONB,                  -- Risk engine output
  llm_verdict     JSONB,                  -- LLM verdict (if applicable)
  outcome         TEXT,                   -- What action was taken
  reason          TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_decisions_recent
  ON agent_decisions (created_at DESC);

-- ==============================================================================
-- LLM VERDICT LOG
-- Tracks LLM advisory verdicts for comparison with actual outcomes
-- ==============================================================================
CREATE TABLE IF NOT EXISTS llm_verdict_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id     UUID        REFERENCES strategies(id),
  trade_log_id    UUID        REFERENCES trade_logs(id),
  provider        TEXT        NOT NULL,   -- 'deepseek' | 'grok'
  mode            TEXT        NOT NULL,   -- 'advisory' | 'active'
  input_payload   JSONB,                  -- What was sent to LLM
  verdict         JSONB,                  -- Structured verdict returned
  confidence      NUMERIC(4,3),
  action          TEXT,                   -- 'proceed' | 'veto' | 'reduce'
  latency_ms      INTEGER,
  cost_usd        NUMERIC(8,6),
  fallback_used   BOOLEAN     DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- Row Level Security (RLS)
-- Supabase requires RLS for tables accessed from client SDK
-- Service role key bypasses RLS — use service role in the agent
-- ==============================================================================
ALTER TABLE ohlcv_candles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE funding_rates          ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategies             ENABLE ROW LEVEL SECURITY;
ALTER TABLE backtest_runs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE optimization_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE wfo_runs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE monte_carlo_runs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE holdout_validation     ENABLE ROW LEVEL SECURITY;
ALTER TABLE final_verdicts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_logs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_decisions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE nansen_token_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE coinglass_scanner_events ENABLE ROW LEVEL SECURITY;

-- Service role has full access to everything (agent uses service role key)
-- No anon/public access to any sensitive table
-- Public read-only access to ohlcv_candles for potential dashboard use (optional):
-- CREATE POLICY "public_read_ohlcv" ON ohlcv_candles FOR SELECT USING (true);

-- ==============================================================================
-- USEFUL VIEWS
-- ==============================================================================

-- Latest strategy status overview
CREATE OR REPLACE VIEW v_strategy_status AS
SELECT
  s.id,
  s.name,
  s.status,
  s.execution_mode,
  s.decision_mode,
  s.is_active,
  fv.verdict AS final_verdict,
  fv.created_at AS verdict_date,
  COUNT(DISTINCT bl.id) AS total_live_trades,
  SUM(CASE WHEN bl.net_pnl_usd IS NOT NULL THEN bl.net_pnl_usd ELSE 0 END) AS total_pnl_usd
FROM strategies s
LEFT JOIN final_verdicts fv ON fv.strategy_id = s.id
LEFT JOIN trade_logs bl ON bl.strategy_id = s.id AND NOT bl.is_paper
GROUP BY s.id, s.name, s.status, s.execution_mode, s.decision_mode, s.is_active,
         fv.verdict, fv.created_at;

-- Daily P&L summary
CREATE OR REPLACE VIEW v_daily_pnl AS
SELECT
  DATE_TRUNC('day', entry_time) AS trade_date,
  strategy_id,
  COUNT(*) AS trades,
  SUM(net_pnl_usd) AS net_pnl_usd,
  SUM(fees_paid_usd) AS fees_paid,
  AVG(r_multiple) AS avg_r_multiple,
  COUNT(CASE WHEN net_pnl_usd > 0 THEN 1 END) AS winners,
  COUNT(CASE WHEN net_pnl_usd <= 0 THEN 1 END) AS losers
FROM trade_logs
WHERE entry_time IS NOT NULL AND NOT is_paper
GROUP BY DATE_TRUNC('day', entry_time), strategy_id
ORDER BY trade_date DESC;
