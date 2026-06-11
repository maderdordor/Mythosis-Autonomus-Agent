# Overfitting Policy
## Mythos Trading Agent — Anti-Overfitting Rules

The enemy of this system is a strategy that looks profitable on historical data
but loses money on unseen data. Overfitting is the primary risk in systematic trading.

---

## The Core Problem

Overfitting (curve fitting) happens when we optimize a strategy's parameters so well
to historical data that the strategy has "memorized" the past rather than learned
a genuine edge. The result: the strategy passes backtests and fails in live trading.

Every rule in this policy exists to prevent that outcome.

---

## Hard Rules

### Rule 1: No Parameter Changes After Seeing Holdout
Once holdout data is revealed, parameters are locked. Any parameter change after
seeing holdout results means starting the validation pipeline over from scratch.

### Rule 2: Walk-Forward Must Pass Before Monte Carlo Can Rescue
A weak WFO result (profitable windows < 70%) cannot be "fixed" by strong Monte Carlo.
WFO is the primary filter. Monte Carlo tests a strategy that already passed WFO.

### Rule 3: One-Trade or One-Period Dependency = AUTO-FAIL
If more than 50% of total backtest profit comes from:
- One single trade
- One single time period (month/quarter)
- One market event (COVID crash, BTC halving)
→ The strategy AUTO-FAILs regardless of other metrics.

### Rule 4: Isolated Parameter Peak = REJECT
If a strategy only works at one specific parameter combination and nearby values
degrade performance sharply → reject. We look for plateaus, not peaks.

### Rule 5: In-Sample vs Out-of-Sample Degradation
If OOS performance is more than 40% worse than IS performance (by Sharpe or expectancy)
→ Overfitting is likely. Document and flag for review.

---

## Overfitting Risk Scoring

The overfitting detector outputs: **LOW / MEDIUM / HIGH**

| Factor | Weight | Trigger |
|---|---|---|
| Parameter count | High | > 8 parameters |
| Trades per parameter | High | < 20 trades per free parameter |
| Sharpe ratio | Medium | IS Sharpe > 3.0 (suspiciously high) |
| IS/OOS Sharpe ratio | High | OOS Sharpe < 60% of IS Sharpe |
| WFO window stability | High | CV of window returns > 1.0 |
| Single-trade dependency | Critical | 1 trade > 30% of total profit |
| Single-period dependency | Critical | 1 period > 40% of total profit |
| Parameter sensitivity | High | >30% performance drop for ±1 step param change |

**HIGH overfitting risk = AUTO-FAIL. Cannot be overridden.**

---

## What to Do When Overfitting is Detected

1. **Reduce parameters** — fewer parameters, stronger the generalization
2. **Require more trades** — if trade count is low, collect more data or widen symbols
3. **Examine the equity curve** — is profit coming from one period?
4. **Revisit edge thesis** — does the underlying behavioral reason still hold?

What NOT to do:
- Do not add more data sources to mask the problem
- Do not add complexity (filters, regime detection) to force a pass
- Do not reduce validation thresholds
- Do not "explain away" the overfitting with post-hoc narratives

---

## The Anti-Overfitting Workflow

```
Strategy Idea
    ↓
Edge Thesis (Section 4.2) — written, honest
    ↓
Small parameter search space (< 8 parameters)
    ↓
In-sample optimization → find ROBUST ZONES, not single peaks
    ↓
WFO: test on rolling out-of-sample windows
    ↓
Holdout: test on untouched final segment
    ↓
Overfitting detector: review all flags
    ↓
Pass or Fail — accept the verdict
```

The pipeline is designed to fail overfit strategies. That is the system working correctly.
A beautiful equity curve that fails WFO is not a near-miss — it is a correctly rejected strategy.

---

## Reference: Signs of Overfitting in Practice

- "It only works with exactly these parameters" (isolated peak)
- "The backtest looks great but it loses money in paper trading" (lookahead or overfit)
- "We just need to add one more filter to fix it" (complexity creep)
- "The drawdown period was a one-time event, ignore it" (narrative excuse)
- "We need to optimize separately for each market regime" (splitting = overfitting)

All of these are warning signs. Trust the pipeline over narratives.
