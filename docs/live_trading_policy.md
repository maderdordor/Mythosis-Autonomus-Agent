# Live Trading Policy
## Mythos Trading Agent — Live Execution Rules

This document governs when and how Mythos transitions from paper trading to live execution.
All promotion decisions are gated. Skipping gates is forbidden.

---

## Default State (Safety Floor)

At any fresh installation or restart:

```
LIVE_TRADING=false
PAPER_TRADING=true (Phase 1+)
EXECUTION_MODE=manual
```

These defaults exist so that a misconfiguration or restart never accidentally
puts the system into unintended live execution.

---

## Execution Modes

| Mode | Description | Requirements |
|---|---|---|
| MANUAL | Agent proposes, human approves every trade | After Gate 2 (paper proof) |
| SEMI_AUTO | Agent executes entries, human approves size increases only | 2 weeks MANUAL with no errors |
| FULL_AUTO | Fully autonomous: execute, manage, exit. Human sets policy + kill switch. | 30 days SEMI_AUTO, stable, no breaches |

---

## Promotion Rules (from brief Section 8.12)

### MANUAL → SEMI_AUTO
Requirements:
- Minimum 2 weeks live in MANUAL mode
- No execution errors of any kind
- Drawdown within expected range (paper backtest comparison)
- No risk engine breaches

### SEMI_AUTO → FULL_AUTO
Requirements:
- Minimum 30 days live in SEMI_AUTO
- Stable performance (positive expectancy maintained)
- Risk engine NEVER breached in live history
- No manual interventions required during the 30 days
- Kill switch and demotion logic tested and confirmed working

### Demotion Rules
- Any kill switch event → strategy immediately back to MANUAL
- Any risk engine breach → strategy back to MANUAL
- Two consecutive losing weeks beyond expected range → review, possible demotion

---

## Gate Requirements

### Gate 2 (Paper → Live MANUAL)
- Paper trading engine: minimum 2 weeks OR 50 signals (whichever is longer)
- For low-frequency strategies: minimum 30 days
- Performance consistent with backtest expectancy (within ±30%)
- No execution errors
- No sharp divergence from backtest expectation

### Gate 3 (Live MANUAL → SEMI_AUTO eligible)
- 100+ live trades
- Positive expectancy across all trades
- All trades within drawdown and risk limits
- Written post-mortem if any loss streak occurred
- Nansen forward-validation available (if Phase 1 integration complete)

---

## Kill Switch Protocols

### Conditions that trigger automatic kill switch:
1. Account drawdown reaches MAX_ACCOUNT_DRAWDOWN (10%)
2. Daily loss reaches MAX_DAILY_LOSS (2%) — blocks new entries for the day
3. Weekly loss reaches MAX_WEEKLY_LOSS (5%) — blocks new entries for the week
4. Loss streak of LOSS_STREAK_COOLDOWN consecutive losses
5. Exchange connectivity error lasting > 5 minutes with open positions
6. Unexpected position size discrepancy between agent state and exchange

### Kill switch behavior:
- Block all new entries immediately
- Log the trigger with full context
- Alert via Telegram (Phase 1+)
- For hard kill (/kill command): flatten all positions, halt agent, require manual restart

---

## API Key Security

- Exchange API key must have read + trading permissions ONLY
- NEVER enable withdrawal permission
- API key is stored only in .env file, never committed to git
- Rotate API keys quarterly or immediately if any suspected compromise

---

## Capital Scale-Up Rule

Capital compounding is only allowed after:
- 3+ months of live history
- All months within drawdown limits
- Positive expectancy maintained throughout

Do not scale capital to "recover" a drawdown period.

---

## Project Kill Criteria (from brief Section 13.1)

The project applies the same verdict discipline to itself:

| Trigger | Action |
|---|---|
| No PASS within 3 months of MVP | Formal review: pivot strategy universe or stop |
| Paper trading diverges from backtest twice | Back to research stage |
| Live MANUAL hits 10% account drawdown | Full halt + written post-mortem before restart |
| LLM_ADVISORY shows no improvement over 200+ signals | LLM permanently removed from decision path |
