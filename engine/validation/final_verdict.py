"""
engine/validation/final_verdict.py
Final Verdict Engine — combines all validation components.
Outputs PASS / MARGINAL / FAIL per brief Section 8.10.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import structlog

from engine.utils.config import cfg

log = structlog.get_logger(__name__)

VERDICT_PASS = "PASS"
VERDICT_MARGINAL = "MARGINAL"
VERDICT_FAIL = "FAIL"


@dataclass
class WFOResult:
    verdict: str  # PASS | MARGINAL | FAIL
    profitable_windows_pct: float
    mean_oos_sharpe: float
    oos_sharpe_cv: float
    flat_region_score: float
    parameter_stable: bool
    single_window_dominance: bool
    reasons: list[str] = field(default_factory=list)


@dataclass
class MCResult:
    verdict: str  # PASS | FAIL
    risk_of_ruin: float
    profitable_pct: float
    worst_drawdown_pct: float
    p5_return_pct: float
    reasons: list[str] = field(default_factory=list)


@dataclass
class HoldoutResult:
    verdict: str  # PASS | FAIL
    total_return_pct: float
    sharpe_ratio: float
    max_drawdown_pct: float
    total_trades: int
    expectancy_usd: float
    reasons: list[str] = field(default_factory=list)


@dataclass
class OverfitResult:
    risk_level: str  # LOW | MEDIUM | HIGH
    flags: dict[str, bool] = field(default_factory=dict)
    reasons: list[str] = field(default_factory=list)


@dataclass
class FeeViabilityResult:
    passed: bool
    avg_gross_edge_pct: float
    required_pct: float
    reason: str = ""


@dataclass
class FinalVerdictResult:
    strategy_id: str
    verdict: str            # PASS | MARGINAL | FAIL
    wfo_verdict: str
    mc_verdict: str
    holdout_verdict: str
    overfit_risk: str
    fee_viability_pass: bool
    failed_components: list[str]
    passed_components: list[str]
    reasons: list[str]
    improvement_suggestions: list[str]
    params: dict[str, Any] = field(default_factory=dict)


def compute_final_verdict(
    strategy_id: str,
    wfo: WFOResult,
    mc: MCResult,
    holdout: HoldoutResult,
    overfit: OverfitResult,
    fee_viability: FeeViabilityResult,
    params: dict[str, Any] | None = None,
) -> FinalVerdictResult:
    """
    Combine all validation components into a final verdict.

    Rules (Section 8.10):
    - FAIL in ANY component → final verdict is FAIL
    - WFO MARGINAL with manual review → acceptable for MARGINAL final
    - Monte Carlo PASS + Holdout PASS + LOW/MEDIUM overfit + fee viable → PASS (if WFO >= MARGINAL)
    - HIGH overfit risk → always FAIL
    - Fee viability FAIL → always FAIL (hard rule, Section 3.4)
    """

    failed_components: list[str] = []
    passed_components: list[str] = []
    reasons: list[str] = []
    suggestions: list[str] = []

    # --- Check WFO ---
    if wfo.verdict == VERDICT_FAIL:
        failed_components.append("WFO")
        reasons.extend(wfo.reasons)
        reasons.append("Walk-Forward Optimization FAILED — this is a hard failure")
        suggestions.append(
            "WFO is the primary filter. "
            "Improve the strategy edge thesis before adjusting parameters. "
            "Do NOT loosen WFO thresholds."
        )
    else:
        passed_components.append("WFO")

    # --- Check Monte Carlo ---
    if mc.verdict == VERDICT_FAIL:
        failed_components.append("Monte Carlo")
        reasons.extend(mc.reasons)
        if mc.risk_of_ruin > 0:
            reasons.append(f"Risk of ruin = {mc.risk_of_ruin:.1%} (must be 0%)")
            suggestions.append("Reduce position sizing or widen stop loss to eliminate ruin scenarios")
        if mc.profitable_pct < 0.80:
            reasons.append(f"Profitable simulations = {mc.profitable_pct:.1%} (must be >= 80%)")
        if mc.worst_drawdown_pct > cfg.MAX_ACCOUNT_DRAWDOWN * 100:
            reasons.append(f"Worst-case drawdown = {mc.worst_drawdown_pct:.1f}% exceeds limit of {cfg.MAX_ACCOUNT_DRAWDOWN*100:.0f}%")
    else:
        passed_components.append("Monte Carlo")

    # --- Check Holdout ---
    if holdout.verdict == VERDICT_FAIL:
        failed_components.append("Holdout")
        reasons.extend(holdout.reasons)
        reasons.append("Strategy fails on untouched holdout data — returns to research")
        suggestions.append(
            "Do not re-optimize with holdout knowledge. "
            "The strategy must be redesigned from the edge thesis."
        )
    else:
        passed_components.append("Holdout")

    # --- Check Overfitting ---
    if overfit.risk_level == "HIGH":
        failed_components.append("Overfitting")
        reasons.extend(overfit.reasons)
        reasons.append("HIGH overfitting risk — cannot go live (Section 8.9)")
        suggestions.append(
            "Reduce parameters, require more trades per parameter, "
            "or check for single-trade/single-period dependency"
        )
    else:
        passed_components.append(f"Overfitting ({overfit.risk_level})")

    # --- Check Fee Viability (hard rule, Section 3.4) ---
    if not fee_viability.passed:
        failed_components.append("Fee Viability")
        reasons.append(
            f"Fee viability FAILED: avg gross edge {fee_viability.avg_gross_edge_pct*100:.3f}% "
            f"< required {fee_viability.required_pct*100:.3f}% "
            f"(FEE_VIABILITY_MULTIPLIER={cfg.FEE_VIABILITY_MULTIPLIER}×round_trip)"
        )
        suggestions.append(
            "The strategy does not generate enough gross edge to survive fees. "
            "Target larger moves, reduce trade frequency, or find a different edge."
        )
    else:
        passed_components.append("Fee Viability")

    # --- Compute final verdict ---
    if failed_components:
        verdict = VERDICT_FAIL
    elif wfo.verdict == VERDICT_MARGINAL:
        verdict = VERDICT_MARGINAL
        reasons.append("WFO is MARGINAL — requires manual review before live promotion")
    else:
        verdict = VERDICT_PASS

    result = FinalVerdictResult(
        strategy_id=strategy_id,
        verdict=verdict,
        wfo_verdict=wfo.verdict,
        mc_verdict=mc.verdict,
        holdout_verdict=holdout.verdict,
        overfit_risk=overfit.risk_level,
        fee_viability_pass=fee_viability.passed,
        failed_components=failed_components,
        passed_components=passed_components,
        reasons=reasons,
        improvement_suggestions=suggestions,
        params=params or {},
    )

    _log_verdict(result)
    return result


def _log_verdict(result: FinalVerdictResult) -> None:
    log.info(
        "Final verdict",
        strategy_id=result.strategy_id,
        verdict=result.verdict,
        wfo=result.wfo_verdict,
        mc=result.mc_verdict,
        holdout=result.holdout_verdict,
        overfit=result.overfit_risk,
        fee_viable=result.fee_viability_pass,
        failed=result.failed_components,
    )

    if result.verdict == VERDICT_FAIL:
        log.warning("Strategy FAILED validation — see improvement suggestions")
        for suggestion in result.improvement_suggestions:
            log.warning(f"  → {suggestion}")
    elif result.verdict == VERDICT_MARGINAL:
        log.info("Strategy is MARGINAL — manual review required before live promotion")
    else:
        log.info("Strategy PASSED all validation gates — eligible for paper trading (Gate 1)")
