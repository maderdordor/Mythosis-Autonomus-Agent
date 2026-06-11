# Risk Policy
## Mythos Trading Agent — Risk Management Rules

Risk management is enforced in code, not prompts. These rules cannot be changed
via LLM output, Telegram commands, or configuration without a full code review.

---

## Hard Risk Limits (from brief Section 8.13)

These are non-negotiable. All are enforced by the risk engine in code.

```
MAX_RISK_PER_TRADE     = 0.5% of equity
MAX_DAILY_LOSS         = 2% of equity
MAX_WEEKLY_LOSS        = 5% of equity
MAX_ACCOUNT_DRAWDOWN   = 10% → hard shutdown
MAX_LEVERAGE           = 2x effective
MAX_OPEN_POSITIONS     = 3 concurrent
LOSS_STREAK_COOLDOWN   = 3 consecutive losses → pause new entries
KILL_SWITCH            = always active
```

---

## Position Sizing

Position size is calculated per trade based on risk rules:

```
position_size = (account_equity × MAX_RISK_PER_TRADE) / distance_to_stop_loss
              = (equity × 0.005) / stop_loss_distance_in_pct

effective_leverage = position_size / account_equity
→ must be <= MAX_LEVERAGE (2x)
```

If the calculated position size would exceed MAX_LEVERAGE:
→ Reduce position size to comply with leverage cap
→ Log the adjustment
→ Do not reject the trade

---

## Trade Frequency Targets

These are OUTPUTS, not inputs:

```
5–30 trades per day across all strategies
```

The agent does not force trades to meet this target.
If a strategy only signals 3 times this week, the agent takes 3 trades.

---

## Per-Trade Risk Rules

Every trade must have:
1. A stop loss defined before entry (no naked positions)
2. Take profit target >= 1.5× stop loss distance (R:R >= 1.5 after fees)
3. Position size within MAX_RISK_PER_TRADE
4. Effective leverage within MAX_LEVERAGE

The risk engine rejects any trade signal missing any of these.

---

## Daily & Weekly Loss Walls

### Daily loss wall (2%)
- When daily P&L reaches -2% of current equity:
  - Block all new entries for the rest of the calendar day (UTC)
  - Keep existing positions open (exit on strategy rules, not panic)
  - Log and alert via Telegram (Phase 1+)

### Weekly loss wall (5%)
- When weekly P&L reaches -5%:
  - Block all new entries for the rest of the calendar week (UTC)
  - Alert owner via Telegram (Phase 1+)
  - Review required before reopening

---

## Drawdown Management

| Drawdown Level | Action |
|---|---|
| > 5% | Log warning, reduce new position sizes by 50% |
| > 7% | Alert owner, halt new entries until review |
| >= 10% | **Hard kill: flatten all positions, halt agent** |

---

## Loss Streak Cooldown

After LOSS_STREAK_COOLDOWN (3) consecutive losses:
- Pause new entries for the strategy
- Re-validate that signal conditions have not changed
- Resume only after the first profitable signal under fresh conditions
- Log every cooldown activation

---

## Per-Strategy Risk Rules (Strategy-Level)

In addition to account-level rules, each strategy defines:
- Stop loss type and distance
- Take profit target (must be >= 1.5R)
- Maximum holding time
- Entry invalidation conditions
- Cooldown after stop-loss exit
- Re-entry requirements

Strategy-level rules must be MORE restrictive than account-level rules.
They cannot relax account-level limits.

---

## What the Risk Engine Can Never Do

- Approve a trade above MAX_RISK_PER_TRADE
- Allow effective leverage above MAX_LEVERAGE
- Ignore a kill switch trigger
- Accept a trade without a stop loss
- Override a Nansen risk block (Phase 1+)
- Be disabled by a prompt, Telegram command, or config change without code review

---

## Telegram Hierarchy (from brief Section 11.7)

Telegram commands sit ABOVE the LLM and BELOW the risk engine:
- Owner can always: stop, pause, demote, flatten, kill
- Owner CANNOT via Telegram: raise risk limits, force an entry the risk engine blocked,
  promote an ineligible strategy to FULL_AUTO

Safety-direction commands always work.
Risk-increasing commands require config + validation changes, not Telegram.
