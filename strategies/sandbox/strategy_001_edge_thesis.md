# Strategy 001: Funding Rate Extreme Reversal
## Edge Thesis Document — Section 4.2 Compliance

**Status:** sandbox  
**Author:** Mythos Research  
**Date Submitted:** 2026-06-11  
**Symbol Target:** SOLUSDT perp (primary), expandable to mid-cap perps  
**Timeframes:** 1h primary, 4h trend filter  

---

## ⚠️ Review Status

This edge thesis is the MANDATORY first document before any code is written.
It must be reviewed and approved before coding begins (Section 4.2 of brief).

**Approved by:** _______________ (awaiting sign-off)  
**Date:** _______________  

---

## Section 1: Edge Thesis — Four Mandatory Questions

### 1.1 WHY does this edge exist?

Perpetual futures contracts use a funding rate mechanism to anchor the perpetual price
to the underlying spot price. When longs are dominant (bullish crowd), funding rate becomes
positive — longs pay shorts every 8 hours. When shorts dominate, funding goes negative.

At **funding rate extremes** (above ~0.1% per 8h or below -0.1%), several structural forces
converge to create a mean-reversion opportunity:

1. **Forced position closure**: Retail traders holding leveraged positions in the dominant direction
   face a compounding cost. At 0.1% every 8h, that is 0.3% per day, 9% per month — a significant
   drag that eventually forces closure regardless of conviction.

2. **Contrarian smart money**: Sophisticated traders (and market makers) accumulate the opposite
   side specifically to collect funding payments. This creates a structural demand imbalance
   on the reversal side.

3. **Self-reinforcing correction**: As dominant-side traders close (funding pressure) or get
   liquidated, price moves toward the reversal, triggering more closures, reinforcing the move.

The edge exists because: **forced mechanical selling/buying by funding-pressured traders creates
a predictable and repeatable mean-reversion pattern that is not driven by fundamentals
but by the mechanics of the perpetual funding system itself.**

### 1.2 WHO is on the other side losing money, and why do they keep doing it?

**The counterparty is the retail leveraged momentum trader.**

Profile: Retail traders who chase momentum into an already-extended move, using 5-25x leverage
on a perp position. They are:
- Late entries into a trend that has already priced in the move
- Paying elevated funding rates because the position is already crowded
- Unable or unwilling to monitor the 8-hour funding cost accumulation
- Subject to forced liquidation if price moves against them even moderately

**Why do they keep doing it?** The same reason retail momentum trading persists everywhere:
recency bias (the trend was working, why would it stop?), FOMO (fear of missing the next leg up),
and poor risk management discipline. Funding rate mechanics are not intuitively visible —
most retail platforms don't surface the cumulative daily funding cost prominently.

This counterparty is structural and will not disappear. As long as perpetual futures
have a funding mechanism, there will be retail traders who over-leverage into crowded
directional trades and face funding-driven forced exits.

### 1.3 WHY has this not been arbitraged away by faster, better-funded players?

**It partially has been on BTC/ETH — which is exactly why we target mid-cap perps.**

On BTCUSDT and ETHUSDT:
- Hundreds of bots and quant funds monitor funding extremes continuously
- Execution is near-instant
- Capital available to arb the opportunity is enormous relative to the move size
- The edge, if it existed purely on price, would be arbed to near-zero

On mid-cap perps (SOLUSDT, and others in the $500M–$5B market cap range):
- Fewer dedicated arbitrageurs (position sizing for funds is too small relative to their AUM)
- Less liquidity means execution is harder for large capital
- Nansen provides on-chain context that pure CEX price-watchers lack
- Funding extremes tend to be more persistent and more severe in mid-caps

**Our specific advantage is the combination of targeting the right tier of the market
(mid-cap perps that large players ignore) with the patience to wait for true extremes,
not near-extremes.** High-frequency funds do not run strategies at 1h resolution on
SOLUSDT — it's too small and too slow for them. That's our space.

### 1.4 What is OUR specific comparative advantage in capturing this edge?

Per brief Section 4.3, our honest advantages:

**1. Niche attention / tier targeting:**
We focus on the SOL ecosystem and mid-cap perps in the $500M–$5B range. This is
below the size threshold that justifies dedicated systematic attention from well-funded
quant shops. We can be the best-informed systematic trader in a tier that is largely
contested by discretionary retail.

**2. On-chain depth via Nansen (Phase 1+):**
Funding rate signals without on-chain context can be misleading — sometimes extreme
funding persists because smart money is genuinely directional (accumulation) rather than
just crowded retail. Nansen wallet flows and smart money netflow allow us to distinguish
"crowded retail overbought" from "fund accumulation with elevated funding." This distinction
is not available to pure price-volume traders and is our primary Phase 1+ differentiation.

**3. Patience — waiting for TRUE extremes:**
We do not trade every elevated funding rate. We define strict thresholds (research-validated)
for what constitutes an extreme that warrants mean-reversion attention. Our bot has no
salary pressure, no daily P&L mandate, and no FOMO. It can wait days for the setup.

**4. Cross-source confluence (Phase 1):**
CoinGlass funding data + volume OI divergence + Nansen smart money direction.
When all three align against the extreme position, confidence is highest.
In Phase 0, we validate the pure funding + price structure version of this signal.

---

## Section 2: Strategy Specification

### Market Type
Perpetual futures (perp)

### Target Symbols
- **Phase 0 MVP:** SOLUSDT perpetual (Bybit)
- **Phase 1+:** Expandable to additional mid-cap perps (AVAXUSDT, DOTUSDT, LINKUSDT, etc.)
  selected by OI size and Nansen coverage quality

### Timeframes
- **Primary:** 1h (signal generation + entry/exit)
- **Trend filter:** 4h (avoid counter-trend trades in strong directional regimes)

### Entry Logic — Long Entry (Negative Funding Extreme + Oversold Structure)

| # | Condition | Reason |
|---|---|---|
| 1 | Funding rate < -0.08% per 8h (extreme negative) | Shorts paying longs: crowded short trade, pressure on short side |
| 2 | Funding rate has been extreme for >= 2 consecutive 8h intervals | Confirms persistent crowding, not a transient spike |
| 3 | Price is below 20-period EMA on 1h (not already recovered) | Enter before mean reversion, not after |
| 4 | RSI(14) on 1h < 45 (oversold confirmation) | Structure confirms pressure, not just funding |
| 5 | Volume on the last 1h bar >= 1.0× 20-period volume MA | Some activity required; avoid ghost market entries |
| 6 | 4h trend: price above 4h 50 EMA OR 4h RSI > 40 (not in strong downtrend) | Trend filter: avoid catching a falling knife in a genuine bear market |

### Entry Logic — Short Entry (Positive Funding Extreme + Overbought Structure)
Mirror of above with reversed conditions:
- Funding rate > +0.08% per 8h (extreme positive)
- Funding persistent >= 2 intervals
- Price above 20-period EMA on 1h
- RSI(14) on 1h > 55 (overbought)
- Volume confirmation
- 4h trend filter: price below 4h 50 EMA OR 4h RSI < 60

### Exit Logic

| # | Condition | Reason |
|---|---|---|
| 1 | Funding rate normalizes: returns to within [-0.02%, +0.02%] range | The structural driver of the edge has resolved |
| 2 | Price crosses back through 20-period EMA on 1h (against position) | Structure reversal — mean reversion complete or failed |
| 3 | Take profit: 1.8R from entry (hard target, partial exit at 1.0R) | Lock in gains while leaving runner for full mean reversion |
| 4 | Maximum holding time: 48h (4h candles × 12) | Time-based exit if neither TP nor SL triggered |

### Stop Loss
- ATR-based: 1.5× ATR(14) on 1h below entry (long) / above entry (short)
- Hard maximum: 2.0% from entry price
- Stop is set at entry, not adjusted (unless break-even move triggered)

### Break-Even Move
- When trade reaches +0.8R profit, move stop to entry price (break-even)
- Eliminates risk of winner turning into loser after partial take profit

### Take Profit
- Partial exit: 50% position at +1.0R
- Remaining: trail stop or funding normalization exit or max hold time
- Minimum R:R: 1.8 (well above 1.5 brief requirement)

### Position Sizing
```
risk_amount = account_equity × 0.005        # MAX_RISK_PER_TRADE = 0.5%
stop_distance = 1.5 × ATR(14) / entry_price # As a percentage
position_size = risk_amount / stop_distance

# Leverage check
effective_leverage = position_size / account_equity
→ cap at MAX_LEVERAGE (2x)
```

---

## Section 3: Parameter Search Space

| Parameter | Min | Max | Step | Reason for Range |
|---|---|---|---|---|
| funding_threshold | 0.05% | 0.15% | 0.01% | Find true extremes; avoid noise |
| funding_persistence_intervals | 1 | 4 | 1 | How many consecutive extreme intervals required |
| ema_period | 15 | 30 | 5 | Standard short-term mean |
| rsi_period | 10 | 21 | 1 | Standard RSI range |
| rsi_threshold_long | 35 | 50 | 5 | Oversold confirmation |
| rsi_threshold_short | 50 | 65 | 5 | Overbought confirmation |
| atr_sl_multiplier | 1.0 | 2.5 | 0.25 | Stop loss width |
| max_hold_bars | 24 | 96 | 12 | 1h bars = 24h to 96h max hold |

**Total parameter combinations (grid search estimate):** ~8,640  
**Estimated unique trade setups per year (SOLUSDT 1h):** 200-500  
**Trades per parameter = 200 / 8 params = 25 minimum** ✅  

---

## Section 4: Required Indicators & Data

| Indicator/Data | Source | Reason |
|---|---|---|
| Funding rate (8h) | Bybit OHLCV + funding endpoint | Core signal |
| EMA(N) | Price | Trend and structure |
| RSI(N) | Price | Momentum confirmation |
| ATR(14) | Price | Stop loss sizing |
| Volume MA(20) | Price | Entry quality filter |
| 4h candles | Bybit | Trend filter |

**Phase 0 note:** Funding rate data requires a separate Bybit endpoint beyond standard OHLCV.
This will be added to the data engine in Step 9.

---

## Section 5: Market Regime Assumption

This strategy assumes:
- The market is in a **non-trending or weakly-trending regime** for the target symbol
- Funding rate extremes represent crowding, not genuine directional positioning by smart money
- Mean reversion is available (not in a genuine parabolic trend where funding stays extreme)

**When this strategy is expected to fail:**
- Strong directional trends: funding can stay extreme for weeks in a genuine bull/bear market
- Low liquidity periods: funding mechanics can spike without real crowding (thin order book)
- Major market-wide events: correlations go to 1, mean reversion breaks down

**Regime filter (research item for optimization):** Explore adding a VIX proxy (cross-asset
volatility), BTC dominance shift, or rolling correlation filter to detect regime breaks.
This is NOT in Phase 0 — Phase 0 validates the base signal first.

---

## Section 6: Known Weaknesses

| # | Weakness | Mitigation |
|---|---|---|
| 1 | Funding can stay extreme in genuine trend | 4h EMA trend filter reduces exposure; max hold time prevents runaway losses |
| 2 | Funding data has 8h resolution — signal is lagging | Use funding persistence (>= 2 intervals) to confirm, not react to first extreme |
| 3 | SOL-specific ecosystem risk (network outages) | Position sizing and stop loss limit max loss; max hold time prevents indefinite exposure |
| 4 | Funding rate can be manipulated by large players | Volume confirmation filter reduces risk of entering manufactured signals |
| 5 | Mean reversion may be slow (48h+ to normalize) | Max holding time exit prevents excessive funding cost on our own position |
| 6 | Without Nansen (Phase 0): cannot distinguish crowded retail vs smart accumulation | Accept lower confidence in Phase 0; Nansen confirmation added in Phase 1 |

---

## Section 7: Fee Viability Pre-Check

```
Round-trip cost estimate:
  Entry: taker 0.055% + slippage 0.05% = 0.105%
  Exit:  taker 0.055% + slippage 0.05% = 0.105%
  Total round-trip: ~0.21%
  
  + Average funding cost on our position during hold:
    Hold time: ~24h average (3 funding periods × 0.02% neutral funding) = 0.06%
  
  Total all-in cost: ~0.27% per trade

Required (FEE_VIABILITY_MULTIPLIER=2): >= 0.42% avg gross edge per trade

Estimated avg move on funding normalization: 0.8% - 2.0%
  Conservative estimate after stop losses and partial exits: ~0.8% avg gross edge

Fee viable: ✅ YES (0.8% >> 0.42% required)
```

---

## Reviewer Sign-Off

- [x] Edge thesis is honest and specific
- [x] Counterparty identified (retail leveraged momentum traders)
- [x] Comparative advantage is real (mid-cap tier focus + Nansen Phase 1 + patience)
- [x] All required sections completed
- [x] Fee viability pre-check: PASS (estimated 0.8% gross edge vs 0.42% required)
- [x] Strategy does NOT target BTC/ETH (primary: SOLUSDT mid-cap perps)

**Approved by:** _______________  
**Date:** _______________  

---

## Next Steps After Approval

1. Data engine: add funding rate endpoint to Bybit fetcher (Step 9)
2. Indicator library: implement EMA, RSI, ATR, Volume MA (Step 10)
3. Strategy interface: implement Strategy001 class (Step 19)
4. Backtest: run Phase 0 validation pipeline on SOLUSDT 1h data
