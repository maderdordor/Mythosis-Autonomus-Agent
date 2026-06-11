# Nansen Policy
## Mythos Trading Agent — Lookahead Bias Warning & Usage Rules

**⚠️ READ THIS BEFORE TOUCHING ANY NANSEN DATA IN BACKTEST CODE ⚠️**

---

## Critical Warning: Retroactive Labels = Lookahead Bias

**Nansen labels are computed retroactively.**

A wallet labeled "90D Smart Trader" today was NOT necessarily labeled that at the time of its
historical trades. Nansen does not provide point-in-time label history.

### What This Means for Backtesting

**We cannot honestly backtest Nansen filters on past data.**

Any backtest that uses today's Nansen labels against historical prices is contaminated.
It will show results that look better than real-world performance. This is not a minor
adjustment factor — it is a fundamental data integrity violation that will produce
strategies that lose money in live trading despite strong backtests.

This is why:

```
IF timestamp_of_nansen_data < nansen_snapshot_collector_start_date:
    RAISE DataIntegrityError("Lookahead bias: cannot use pre-collector Nansen data in backtest")
```

This check is enforced in code. It cannot be bypassed by a prompt or config flag.

---

## The Solution: Point-in-Time Dataset

The `nansenSnapshotCollector` runs from **day one of the project**, continuously
snapshotting wallet scores, labels, and netflow into the database.

This creates our own point-in-time dataset where we know exactly what data was
available at what timestamp.

### When Nansen Filters Become Backtestable

Only AFTER sufficient snapshot history has accumulated (minimum 4-8 weeks of data),
can we run forward-validation of Nansen-based rules.

Forward-validation means: comparing strategy performance WITH vs WITHOUT the Nansen
filter, using only data collected AFTER the collector started.

---

## Rules for Nansen Data Usage

### Allowed in Phase 0
- `nansenSnapshotCollector` running passively: ✅ YES
- Storing snapshots to database: ✅ YES
- Viewing/analyzing snapshot data manually: ✅ YES

### Forbidden in Phase 0
- Any Nansen signal used in backtest: ❌ NO
- Any Nansen feature column in training data: ❌ NO
- Any Nansen filter in paper trading: ❌ NO

### Phase 1+ (after collector has run >= 4 weeks)
- Nansen confidence layer in PAPER trading: ✅ YES (as live layer, not backtest)
- Forward-validation of Nansen rules: ✅ YES (snapshot-era data only)
- Nansen in backtest with pre-collector data: ❌ ALWAYS FORBIDDEN

---

## Validation Requirements for Any Nansen Rule

A Nansen filter is accepted only if it meets ALL of these:
1. Sufficient sample size (minimum 200 signals with/without filter comparison)
2. WFO shows performance improvement in OOS windows
3. Monte Carlo: pass with filter active
4. Holdout: pass with filter active
5. Opportunity cost: filter does not reduce trade frequency below minimum threshold
6. Effect on catastrophic losses: filter must reduce tail risk, not just headline return

**Never add a Nansen rule because one trade worked.**

---

## Database Enforcement

The backtest engine checks `nansen_snapshot_collector_start_date` (stored in the
`system_config` table) against any Nansen feature timestamps.

Any backtest run that contains Nansen features dated before the collector start
will be REJECTED with an explicit error message.

---

## Collector Configuration

```env
NANSEN_ENABLED=false     # Set to true only to run the collector
NANSEN_API_KEY=          # Required for collector
NANSEN_MAX_DAILY_CREDITS=5000
NANSEN_CACHE_TTL_SECONDS=60
NANSEN_WALLET_LABEL_CACHE_HOURS=24
```

The collector polls on a safe interval that respects the $50/month API tier credit budget.
It logs credit usage after every API call.

---

*Last reviewed: Phase 0 setup*  
*Next review: Before Phase 1 Nansen integration*
