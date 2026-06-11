# Strategy Template
## Mythos Trading Agent — Strategy Submission Form

Every strategy MUST fill this template before any code is written.
"It backtests well" is NOT an edge thesis. If the edge thesis cannot be stated
in one honest paragraph, the strategy does not get coded.

---

## Strategy Name
<!-- Example: Funding Rate Extreme Reversal -->

## Status
<!-- sandbox | validated | rejected | live_ready -->
`sandbox`

## Author
<!-- Your name/handle -->

## Date Submitted
<!-- YYYY-MM-DD -->

---

## Section 1: Edge Thesis (MANDATORY — Section 4.2 of brief)

Answer all four questions. Each answer must be at least one honest paragraph.
Vague or optimistic answers disqualify the strategy.

### 1.1 WHY does this edge exist?
<!--
Describe the structural reason this edge exists in the market.
Examples: behavioral bias, structural forced flow, regime effect, information asymmetry.
DO NOT say "it backtests well" or "the pattern repeats."
-->

### 1.2 WHO is on the other side losing money, and why do they keep doing it?
<!--
Name the counterparty. Explain why they will continue to take the losing side.
Examples: leveraged retail forced to close due to funding costs, arbitrageurs with slower latency,
market makers hedging large inventory.
-->

### 1.3 WHY has this not been arbitraged away by faster, better-funded players?
<!--
Be honest. If you cannot answer this, the strategy is probably already arbed.
Examples: too small/illiquid for funds, requires on-chain context they don't monitor,
edge exists in regimes funds ignore.
-->

### 1.4 What is OUR specific comparative advantage in capturing this edge?
<!--
Reference Section 4.3 of the brief. We have:
- Niche attention: smaller-cap perps, funding extremes, regime filters
- On-chain depth: Solana ecosystem via Nansen
- Patience: bot with no salary pressure
- Cross-source confluence: derivatives (CoinGlass) + on-chain (Nansen) + structure
-->

---

## Section 2: Strategy Specification

### Market Type
<!-- spot | perp | both -->

### Target Symbols
<!-- Example: SOLUSDT (perp), top 50 mid-cap perps by OI -->
<!-- Avoid BTC/ETH unless strong differentiated thesis -->

### Timeframes
<!-- Example: 1h primary, 4h trend filter -->

### Entry Logic
<!--
List every condition required for entry. Each condition must have a written reason.
No adding conditions after one loss.
-->

| # | Condition | Reason |
|---|---|---|
| 1 | | |
| 2 | | |

### Exit Logic
<!-- Strategy exit conditions (not stop loss/TP — those are below) -->

| # | Condition | Reason |
|---|---|---|
| 1 | | |

### Stop Loss
<!-- Type: fixed %, ATR-based, structure-based -->

### Take Profit
<!-- Type: fixed R:R, partial exits, trailing -->
<!-- Target: R:R >= 1.5 after fees (brief Section 3.2) -->

### Position Sizing
<!-- How is size determined? Must reference risk engine: MAX_RISK_PER_TRADE=0.005 -->

---

## Section 3: Parameter Search Space

Define the search space for optimization. Do NOT optimize toward a single best point —
the optimizer finds robust zones (flat regions, stable clusters).

| Parameter | Min | Max | Step | Reason for Range |
|---|---|---|---|---|
| | | | | |

---

## Section 4: Required Indicators & Data

| Indicator/Data | Source | Reason |
|---|---|---|
| | | |

---

## Section 5: Market Regime Assumption

<!--
What market conditions is this strategy designed for?
Examples: trending markets, high volatility, low correlation to BTC, specific funding rate regime
What happens if regime changes? Does the strategy have a regime filter?
-->

---

## Section 6: Known Weaknesses

<!--
List the scenarios where this strategy is expected to fail.
Be honest. Hiding weaknesses here means they become surprises in live trading.
Examples:
- Choppy/ranging markets with no trend
- News-driven spike reversals
- Low liquidity in target symbols
- Funding rate manipulation
-->

| # | Weakness | Mitigation |
|---|---|---|
| 1 | | |

---

## Section 7: Fee Viability Pre-Check

Before coding: estimate if the edge is viable after fees.

```
Round-trip cost = TAKER_FEE (0.055%) + TAKER_FEE (0.055%) + 2 × SLIPPAGE (0.05%)
               = 0.21% per trade

Required: avg_gross_edge_per_trade >= 2 × 0.21% = 0.42%

My estimate of avg gross edge: ____%
Fee viable: YES / NO / UNCERTAIN
```

If NO or UNCERTAIN → reconsider before coding.

---

## Reviewer Sign-Off

- [ ] Edge thesis is honest and specific (not "it backtests well")
- [ ] Counterparty is identified
- [ ] Comparative advantage is real (references Section 4.3)
- [ ] All required sections are completed
- [ ] Fee viability pre-check done
- [ ] Strategy does NOT target BTC/ETH without strong differentiated thesis

**Approved by:** _______________  
**Date:** _______________
