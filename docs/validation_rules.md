# Validation Rules
## Mythos Trading Agent — Pass/Fail Criteria Reference

This document is the authoritative checklist for strategy validation.
All criteria are sourced from the developer brief. Do not modify these thresholds
to make strategies pass — adjust the strategy instead.

---

## Final Verdict Logic

A strategy receives PASS only if ALL components pass.
A single FAIL in any component = FAIL overall.

```
Final Verdict = WFO × Monte Carlo × Holdout × Overfitting × Fee Viability × Risk Policy
              = ALL must be non-FAIL
```

---

## 1. Walk-Forward Optimization (WFO) — Section 8.6

The most important validation module. If WFO fails, nothing else matters.

| Criterion | Threshold | Configurable |
|---|---|---|
| Profitable windows | >= 70% | Yes |
| Mean OOS Sharpe | > 1.0 | Yes |
| Performance stability CV | <= 1.0 | Yes |
| Flat region score | >= 0.7 | Yes |
| Parameter instability | None major | — |
| Single window dominance | No window dominates total profit | — |

**Auto-FAIL triggers:**
- Any profitable windows < 70%
- Mean OOS Sharpe <= 1.0
- Evidence of parameter instability across windows

---

## 2. Monte Carlo Stress Test — Section 8.7

Minimum 10,000 simulations required.

Methods tested: trade reshuffling, block bootstrap, trade skipping,
slippage/fee increase, entry/exit delay, loss clustering, worst-case sequencing.

| Criterion | Threshold |
|---|---|
| Risk of ruin | 0% (zero) |
| Profitable simulations | >= 80% |
| Worst-case drawdown | <= MAX_ACCOUNT_DRAWDOWN (10%) |
| 5th percentile return | > 0 |

**Auto-FAIL triggers:**
- Risk of ruin > 0%
- Profitable simulations < 80%
- Worst-case drawdown exceeds account drawdown limit

---

## 3. Holdout Validation — Section 8.8

The untouched final segment. Never used during optimization.

Rules:
- Holdout data is locked until the final verdict run
- No parameter changes after seeing holdout results
- If holdout fails, strategy returns to research (no re-optimization)

**Auto-FAIL triggers:**
- Strategy fails on holdout set
- Evidence of parameter adjustment after holdout peek

---

## 4. Overfitting Detector — Section 8.9

| Risk Level | Action |
|---|---|
| LOW | Proceed |
| MEDIUM | Proceed with documentation |
| HIGH | **AUTO-FAIL — cannot go live** |

Checks for:
- Too many parameters vs. trade count
- Unrealistically high Sharpe (> 3.0 in backtest is suspicious)
- Unstable parameter sensitivity
- Train good, test bad pattern
- One-period or one-trade dependency
- Isolated parameter peak instead of plateau

---

## 5. Fee Viability Check — Section 3.4

```
avg_gross_edge_per_trade >= FEE_VIABILITY_MULTIPLIER × round_trip_cost

round_trip_cost = entry_fee + exit_fee + 2 × slippage + estimated_funding
               ≈ 0.055% + 0.055% + 0.1% = ~0.21% for basic round-trip

FEE_VIABILITY_MULTIPLIER = 2

Required: avg_gross_edge >= 0.42% per trade
```

**Auto-FAIL if fee viability check fails, regardless of headline return.**
This is a hard rule — it cannot be overridden by backtest results.

---

## 6. Execution Realism — Section 8.4

All backtests must use:

| Parameter | Value |
|---|---|
| Maker fee | 0.02% (MAKER_FEE=0.0002) |
| Taker fee | 0.055% (TAKER_FEE=0.00055) |
| Slippage | 0.05% each side (SLIPPAGE=0.0005) |
| Entry delay | 1 bar (ENTRY_DELAY_BARS=1) |
| Exit delay | 1 bar (EXIT_DELAY_BARS=1) |

No strategy may use open-bar execution, zero slippage, or reduced fees.

---

## 7. Risk Policy Compliance — Section 8.13

| Parameter | Limit |
|---|---|
| Risk per trade | <= 0.5% of equity |
| Max leverage | <= 2x effective |
| Max open positions | <= 3 concurrent |
| Daily loss limit | <= 2% |
| Weekly loss limit | <= 5% |
| Account drawdown | <= 10% |

---

## 8. Minimum Trade Count Requirements

| Metric | Minimum |
|---|---|
| Total trades in backtest | >= 100 (to be statistically meaningful) |
| Trades per WFO window | >= 10 |
| Trades in holdout period | >= 20 |

---

## What Happens on FAIL

When a component fails, the final verdict engine outputs:
1. Which component failed
2. Why it failed (specific metric vs. threshold)
3. What to improve (diagnostic, not a command to loosen thresholds)

The response to a FAIL is always one of:
- Fix the strategy's edge thesis
- Improve the strategy's rules
- Abandon the strategy and start fresh

**The response to a FAIL is NEVER:**
- Lower the validation thresholds
- Add more data sources without fixing the core edge
- Add LLM or intelligence layers to compensate
