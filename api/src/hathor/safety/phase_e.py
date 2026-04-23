"""Phase E — Reasoning Safety Loop (per-recommendation).

Validates agent-emitted Recommendation objects against deterministic clinical rules
before they reach the clinician UI or the FHIR bundle. No LLM calls. No hardcoded
pipeline. This is the output boundary gate.

Rule registry (9 rules — 4 implemented, 5 stubs):

  HATHOR-AGE-001    min_age_valid                       IMPLEMENTED
  HATHOR-DOSE-001   max_dose_count                      IMPLEMENTED
  HATHOR-DOSE-002   min_interval_met                    IMPLEMENTED
  HATHOR-AGE-002    antigen_in_scope                    IMPLEMENTED
  HATHOR-EPI-001    component_antigen_satisfaction      STUB (Q2 — CLINICAL_DECISIONS.md)
  HATHOR-DOSE-003   acip_grace_period                   STUB (Q4 — CLINICAL_DECISIONS.md)
  HATHOR-EPI-002    live_vaccine_coadmin                STUB (Q5 — CLINICAL_DECISIONS.md)
  HATHOR-AGE-003    rotavirus_age_cutoff                STUB (Q6 — CLINICAL_DECISIONS.md)
  HATHOR-CONTRA-001 contraindication_source_conflict    STUB (Q11 — CLINICAL_DECISIONS.md)

Schedule precedence: egypt_rules > dak_rules > general_defaults (Q3 — resolved).
Egypt schedule data (data/schedules/egypt.json) is the primary source for age and
interval thresholds. DAK/ACIP defaults apply when Egypt is silent.

Composition semantics (Adjustment 2 — approved):
  A rule may declare ``supersedes: "<earlier_rule_id>"`` on its ValidationResult.
  The engine moves the superseded result to the ``superseded`` list and removes it
  from ``active``. Both lists are available for FHIR Provenance logging. Stub rules
  return None (no result) so composition only activates when a real body is written.
  Designed now so HATHOR-DOSE-003 can supersede HATHOR-DOSE-002 without a schema
  change when Q4 lands.
"""

import json
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Callable

from hathor.schemas.recommendation import Recommendation, ValidationResult
from hathor.tools.dose_validation import MIN_AGE_DAYS
from hathor.tools.intervals import INTERVAL_RULES

# ── Egypt schedule — loaded once at import time ───────────────────────────────

_SCHEDULES_DIR = Path(__file__).parent.parent.parent.parent.parent / "data" / "schedules"


def _load_egypt() -> dict:
    with open(_SCHEDULES_DIR / "egypt.json") as f:
        return json.load(f)


_EGYPT = _load_egypt()

# (antigen, dose_number) → minimum age in days
# Egypt minimum_age_months × 30 (Q3: Egypt supersedes ACIP/DAK baseline)
_EG_MIN_AGE_DAYS: dict[tuple[str, int], int] = {
    (d["antigen"], d["dose_number"]): d["minimum_age_months"] * 30
    for d in _EGYPT["doses"]
    if "minimum_age_months" in d
}

# antigen → maximum dose number in Egypt schedule
_EG_MAX_DOSE: dict[str, int] = {}
for _d in _EGYPT["doses"]:
    _ag = _d["antigen"]
    _EG_MAX_DOSE[_ag] = max(_EG_MAX_DOSE.get(_ag, 0), _d["dose_number"])

# (antigen, from_dose, to_dose) → minimum interval in days
# Egypt interval_rules take precedence over ACIP standard_min_days (Q3)
_EG_INTERVALS: dict[tuple[str, int, int], int] = {
    (r["antigen"], r["from_dose"], r["to_dose"]): r["minimum_interval_days"]
    for r in _EGYPT.get("interval_rules", [])
}

# ── Phase 1 antigen scope (Q7 — resolved) ─────────────────────────────────────

#: Antigens present in the Nigerian + Egyptian EPI schedules (Phase 1 scope).
#: Recommendations about antigens outside this set trigger HATHOR-AGE-002 (fail).
# ── Combination vaccine component map (Q2 — resolved) ─────────────────────────

#: Canonical antigen → ordered list of component antigens it satisfies.
#: "DPT" is the wP/aP-normalized pertussis token (see _normalize_pertussis).
#: All entries represent WHO-prequalified combination categories.
COMBINATION_COMPONENTS: dict[str, list[str]] = {
    "Hexavalent":  ["DPT", "HepB", "Hib", "IPV"],       # DTaP or DTPw + HepB + Hib + IPV
    "Pentavalent": ["DPT", "HepB", "Hib"],               # Nigerian EPI 5-in-1; no IPV
    "MMR":         ["Measles", "Mumps", "Rubella"],
    "MR":          ["Measles", "Rubella"],
    "MMRV":        ["Measles", "Mumps", "Rubella", "Varicella"],
}


def _normalize_pertussis(antigen: str) -> str:
    """Normalize wP (DPT) and aP (DTaP, DT) variants to a single token.

    Per Q2 decision: wP and aP are interchangeable for primary series completion.
    The engine uses "DPT" as the canonical pertussis token for age/interval lookups
    because Egypt's EPI uses DTPw whole-cell — the normalized token matches the
    Egypt schedule keys.
    """
    return "DPT" if antigen in ("DTaP", "DT") else antigen


# ── Phase 1 antigen scope (Q7 — resolved) ─────────────────────────────────────

#: Antigens present in the Nigerian + Egyptian EPI schedules (Phase 1 scope).
#: Recommendations about antigens outside this set trigger HATHOR-AGE-002 (fail).
PHASE1_ANTIGENS: frozenset[str] = frozenset({
    # Egypt EPI (compulsory + recommended)
    "HepB", "BCG", "OPV", "Hexavalent", "MMR", "DTaP", "DT", "PCV", "Varicella",
    # Nigeria EPI
    "Pentavalent", "IPV", "Measles", "YellowFever", "MenA",
    # Component antigens (sub-parts of combination vaccines)
    "DPT", "Hib", "Rubella", "Mumps",
    # WHO universals present in either schedule
    "Rotavirus", "HepA", "MenACWY", "MenC",
})

# ── Clinical context ──────────────────────────────────────────────────────────


@dataclass
class ClinicalContext:
    """Runtime context required by Phase E rules.

    ``confirmed_doses`` is the post-HITL dose list the agent reasoned from.
    Each entry is a dict with at minimum:
      {"antigen": str, "date_administered": str (ISO), "dose_number": int | None}
    """

    child_dob: date
    target_country: str
    confirmed_doses: list[dict] = field(default_factory=list)


# ── Rule type alias ───────────────────────────────────────────────────────────

RuleFn = Callable[[Recommendation, ClinicalContext], ValidationResult | None]

# ── Implemented rules ─────────────────────────────────────────────────────────


def _rule_min_age_valid(rec: Recommendation, ctx: ClinicalContext) -> ValidationResult | None:
    """HATHOR-AGE-001 — min_age_valid.

    A dose recommendation is invalid if the dose was or would be administered before
    the minimum eligible age for that antigen and dose number in the Egypt EPI schedule.
    Egypt minimum supersedes the ACIP/DAK baseline per Q3.

    Applies to: dose_verdict (historical dose — checks administration date),
                due / overdue / catchup_visit (future dose — checks target_date).
    Does not apply to: contra (no dose administration implied).
    Returns None when insufficient data to evaluate (no source dose index, no target_date).
    """
    if rec.kind == "contra":
        return None
    if rec.dose_number is None:
        return None

    age_days: int | None = None

    if rec.kind == "dose_verdict" and rec.source_dose_indices:
        idx = rec.source_dose_indices[0]
        if 0 <= idx < len(ctx.confirmed_doses):
            date_str = ctx.confirmed_doses[idx].get("date_administered")
            if date_str:
                try:
                    age_days = (datetime.fromisoformat(date_str).date() - ctx.child_dob).days
                except ValueError:
                    return None
    elif rec.target_date is not None:
        age_days = (rec.target_date - ctx.child_dob).days

    if age_days is None:
        return None

    # Egypt schedule minimum (Q3 — preferred); fall back to ACIP/DAK default
    eg_key = (rec.antigen, rec.dose_number)
    if eg_key in _EG_MIN_AGE_DAYS:
        min_days = _EG_MIN_AGE_DAYS[eg_key]
        source = "Egypt EPI schedule"
    else:
        min_days = MIN_AGE_DAYS.get(rec.antigen, 42)
        source = "ACIP/DAK default"

    if age_days >= min_days:
        return ValidationResult(
            recommendation_id=rec.recommendation_id,
            severity="pass",
            rule_id="HATHOR-AGE-001",
            rule_slug="min_age_valid",
            rule_rationale=(
                f"Dose at {age_days} days meets minimum age of {min_days} days "
                f"for {rec.antigen} dose {rec.dose_number} ({source})."
            ),
        )
    return ValidationResult(
        recommendation_id=rec.recommendation_id,
        severity="fail",
        rule_id="HATHOR-AGE-001",
        rule_slug="min_age_valid",
        rule_rationale=(
            f"Dose at {age_days} days is below minimum age of {min_days} days "
            f"for {rec.antigen} dose {rec.dose_number} ({source}). "
            "Dose must be administered after the minimum age."
        ),
    )


def _rule_max_dose_count(rec: Recommendation, ctx: ClinicalContext) -> ValidationResult | None:
    """HATHOR-DOSE-001 — max_dose_count.

    A recommendation referencing a dose number that exceeds the maximum doses for
    that antigen in the Egypt EPI schedule is invalid. Prevents recommendations for
    a fourth dose of an antigen whose series ends at three.

    Returns None when dose_number is None or the antigen is not in the Egypt schedule
    (antigen_in_scope handles out-of-scope antigens separately).
    """
    if rec.dose_number is None:
        return None
    if rec.antigen not in _EG_MAX_DOSE:
        return None

    max_dose = _EG_MAX_DOSE[rec.antigen]
    if rec.dose_number <= max_dose:
        return ValidationResult(
            recommendation_id=rec.recommendation_id,
            severity="pass",
            rule_id="HATHOR-DOSE-001",
            rule_slug="max_dose_count",
            rule_rationale=(
                f"Dose {rec.dose_number} of {rec.antigen} is within the Egypt schedule "
                f"maximum of {max_dose} dose(s)."
            ),
        )
    return ValidationResult(
        recommendation_id=rec.recommendation_id,
        severity="fail",
        rule_id="HATHOR-DOSE-001",
        rule_slug="max_dose_count",
        rule_rationale=(
            f"Dose {rec.dose_number} of {rec.antigen} exceeds the Egypt EPI schedule "
            f"maximum of {max_dose} dose(s). Recommendation is outside the schedule."
        ),
    )


def _rule_min_interval_met(rec: Recommendation, ctx: ClinicalContext) -> ValidationResult | None:
    """HATHOR-DOSE-002 — min_interval_met.

    Consecutive doses in a series must meet the minimum required interval. This is
    the base rule; ACIP grace-period semantics (Q4) are handled separately by stub
    HATHOR-DOSE-003. When Q4 is implemented, its result may supersede this rule's
    fail verdict by returning ``supersedes="HATHOR-DOSE-002"``.

    Egypt interval_rules take precedence over the ACIP standard_min_days (Q3).

    Applies to: dose_verdict with dose_number >= 2 AND at least 2 source_dose_indices
    pointing to confirmed doses with parseable date_administered values.
    Returns None for all other recommendation kinds or insufficient data.
    """
    if rec.kind != "dose_verdict":
        return None
    if rec.dose_number is None or rec.dose_number < 2:
        return None
    if len(rec.source_dose_indices) < 2:
        return None

    current_idx = rec.source_dose_indices[-1]
    prior_idx = rec.source_dose_indices[-2]

    if current_idx >= len(ctx.confirmed_doses) or prior_idx >= len(ctx.confirmed_doses):
        return None

    current_date_str = ctx.confirmed_doses[current_idx].get("date_administered")
    prior_date_str = ctx.confirmed_doses[prior_idx].get("date_administered")
    if not current_date_str or not prior_date_str:
        return None

    try:
        current_date = datetime.fromisoformat(current_date_str).date()
        prior_date = datetime.fromisoformat(prior_date_str).date()
    except ValueError:
        return None

    actual_interval = (current_date - prior_date).days
    from_dose = rec.dose_number - 1

    # Egypt interval rules (Q3 — preferred); fall back to ACIP default
    eg_key = (rec.antigen, from_dose, rec.dose_number)
    if eg_key in _EG_INTERVALS:
        min_interval = _EG_INTERVALS[eg_key]
        source = "Egypt EPI schedule"
    else:
        rule_entry = INTERVAL_RULES.get(rec.antigen, {})
        min_interval = rule_entry.get("standard_min_days", 28)
        source = rule_entry.get("source", "ACIP default")

    if actual_interval >= min_interval:
        return ValidationResult(
            recommendation_id=rec.recommendation_id,
            severity="pass",
            rule_id="HATHOR-DOSE-002",
            rule_slug="min_interval_met",
            rule_rationale=(
                f"Interval of {actual_interval} days meets the {min_interval}-day minimum "
                f"for {rec.antigen} doses {from_dose}→{rec.dose_number} ({source})."
            ),
        )
    return ValidationResult(
        recommendation_id=rec.recommendation_id,
        severity="fail",
        rule_id="HATHOR-DOSE-002",
        rule_slug="min_interval_met",
        rule_rationale=(
            f"Interval of {actual_interval} days is below the {min_interval}-day minimum "
            f"for {rec.antigen} doses {from_dose}→{rec.dose_number} ({source}). "
            "Dose may need to be repeated. HATHOR-DOSE-003 (ACIP grace period) is "
            "deferred pending CLINICAL_DECISIONS.md Q4."
        ),
    )


def _rule_antigen_in_scope(rec: Recommendation, ctx: ClinicalContext) -> ValidationResult | None:
    """HATHOR-AGE-002 — antigen_in_scope.

    Severity is fail because agent-initiated out-of-scope recommendations indicate
    prompt drift; clinician override via the standard override path is available for
    legitimate edge cases (e.g. a Phase 1 child who also received a travel vaccine
    not in the Nigeria + Egypt EPI intersection).

    Phase 1 scope: antigens present in the Nigerian + Egyptian EPI schedules
    (Q7 — resolved). Defined as PHASE1_ANTIGENS in this module.
    """
    if rec.antigen in PHASE1_ANTIGENS:
        return ValidationResult(
            recommendation_id=rec.recommendation_id,
            severity="pass",
            rule_id="HATHOR-AGE-002",
            rule_slug="antigen_in_scope",
            rule_rationale=(
                f"{rec.antigen} is within Phase 1 Nigeria + Egypt EPI antigen scope."
            ),
        )
    return ValidationResult(
        recommendation_id=rec.recommendation_id,
        severity="fail",
        rule_id="HATHOR-AGE-002",
        rule_slug="antigen_in_scope",
        rule_rationale=(
            f"{rec.antigen} is outside the Phase 1 Nigeria + Egypt EPI antigen scope. "
            "Recommendations about out-of-scope antigens indicate agent prompt drift. "
            "Clinician override available for legitimate edge cases."
        ),
    )


# ── Stub rules ────────────────────────────────────────────────────────────────


def _rule_component_antigen_satisfaction(rec: Recommendation, ctx: ClinicalContext) -> ValidationResult | None:
    """HATHOR-EPI-001 — component_antigen_satisfaction.

    A combination vaccine dose satisfies the destination schedule's per-component
    requirements when: (1) the product is a known WHO-prequalified combination
    (identified by membership in COMBINATION_COMPONENTS), (2) the dose was
    administered at or after the combination's minimum age in the Egypt EPI schedule,
    (3) the interval to the prior dose meets the Egypt or ACIP/DAK minimum.

    wP (DPT) and aP (DTaP) are interchangeable per Q2 (CLINICAL_DECISIONS.md).
    Pertussis variants are normalized via _normalize_pertussis before schedule lookups.

    Applies to: dose_verdict on known combination antigens (Hexavalent, Pentavalent,
    MMR, MR, MMRV). Returns None for monovalent antigens and unknown combinations.
    HATHOR-AGE-001 and HATHOR-DOSE-002 validate the same dose independently;
    this rule adds per-combination WHO-prequalification check and wP/aP semantics.

    See docs/CLINICAL_DECISIONS.md Q2 for the full clinical rationale.
    """
    if rec.kind != "dose_verdict":
        return None

    components = COMBINATION_COMPONENTS.get(rec.antigen)
    if components is None:
        return None  # monovalent or unknown combination — other rules handle this

    if rec.dose_number is None or not rec.source_dose_indices:
        return None

    # Current dose is always the last source index; prior dose (for interval) is second-to-last.
    current_idx = rec.source_dose_indices[-1]
    if current_idx >= len(ctx.confirmed_doses):
        return None

    date_str = ctx.confirmed_doses[current_idx].get("date_administered")
    if not date_str:
        return None

    try:
        dose_date = datetime.fromisoformat(date_str).date()
    except ValueError:
        return None

    age_days = (dose_date - ctx.child_dob).days

    # Min age: use combination's Egypt-schedule minimum (Q3); fall back to
    # the maximum component minimum (ACIP/DAK) with wP/aP normalization.
    eg_comb_key = (rec.antigen, rec.dose_number)
    if eg_comb_key in _EG_MIN_AGE_DAYS:
        effective_min_age = _EG_MIN_AGE_DAYS[eg_comb_key]
        age_source = "Egypt EPI schedule"
    else:
        effective_min_age = max(
            MIN_AGE_DAYS.get(_normalize_pertussis(c), MIN_AGE_DAYS.get(c, 42))
            for c in components
        )
        age_source = "ACIP/DAK component maximum"

    age_ok = age_days >= effective_min_age

    # Interval check for dose ≥ 2
    interval_ok = True
    actual_interval: int | None = None
    effective_min_interval: int | None = None
    interval_source: str | None = None

    if rec.dose_number >= 2 and len(rec.source_dose_indices) >= 2:
        prior_idx = rec.source_dose_indices[-2]
        if prior_idx < len(ctx.confirmed_doses):
            prior_date_str = ctx.confirmed_doses[prior_idx].get("date_administered")
            if prior_date_str:
                try:
                    prior_date = datetime.fromisoformat(prior_date_str).date()
                    actual_interval = (dose_date - prior_date).days
                    from_dose = rec.dose_number - 1

                    # Egypt combination interval rule (Q3 — preferred)
                    eg_int_key = (rec.antigen, from_dose, rec.dose_number)
                    if eg_int_key in _EG_INTERVALS:
                        effective_min_interval = _EG_INTERVALS[eg_int_key]
                        interval_source = "Egypt EPI schedule"
                    else:
                        # Max component interval with wP/aP normalization
                        effective_min_interval = max(
                            INTERVAL_RULES.get(
                                _normalize_pertussis(c),
                                INTERVAL_RULES.get(c, {}),
                            ).get("standard_min_days", 28)
                            for c in components
                        )
                        interval_source = "ACIP/DAK component maximum"

                    interval_ok = actual_interval >= effective_min_interval
                except ValueError:
                    pass

    if age_ok and interval_ok:
        return ValidationResult(
            recommendation_id=rec.recommendation_id,
            severity="pass",
            rule_id="HATHOR-EPI-001",
            rule_slug="component_antigen_satisfaction",
            rule_rationale=(
                f"{rec.antigen} dose {rec.dose_number} satisfies all {len(components)} component "
                f"antigens ({', '.join(components)}). WHO-aligned combination; "
                "wP/aP interchangeable per Q2 decision."
            ),
        )

    reasons: list[str] = []
    if not age_ok:
        reasons.append(
            f"age {age_days} days is below minimum {effective_min_age} days ({age_source})"
        )
    if not interval_ok and actual_interval is not None:
        reasons.append(
            f"interval {actual_interval} days is below minimum {effective_min_interval} days ({interval_source})"
        )

    return ValidationResult(
        recommendation_id=rec.recommendation_id,
        severity="fail",
        rule_id="HATHOR-EPI-001",
        rule_slug="component_antigen_satisfaction",
        rule_rationale=(
            f"{rec.antigen} dose {rec.dose_number}: component satisfaction failed — "
            f"{'; '.join(reasons)}."
        ),
    )


def _stub_acip_grace_period(rec: Recommendation, ctx: ClinicalContext) -> ValidationResult | None:
    """HATHOR-DOSE-003 — acip_grace_period — STUB.

    Blocked on Q4 (CLINICAL_DECISIONS.md): determines whether a dose administered
    within 4 days of the minimum age or minimum interval qualifies as valid under
    ACIP grace semantics.

    When implemented, this rule supersedes HATHOR-DOSE-002 (min_interval_met) by
    returning a result with ``supersedes="HATHOR-DOSE-002"`` when grace applies.
    Example:
        return ValidationResult(
            ..., severity="pass", rule_id="HATHOR-DOSE-003",
            supersedes="HATHOR-DOSE-002",
        )
    """
    return None  # Q4 deferred — no-op until CLINICAL_DECISIONS.md lands


def _stub_live_vaccine_coadmin(rec: Recommendation, ctx: ClinicalContext) -> ValidationResult | None:
    """HATHOR-EPI-002 — live_vaccine_coadmin — STUB.

    Blocked on Q5 (CLINICAL_DECISIONS.md): validates that live vaccines (MMR,
    Varicella, OPV, YellowFever) were either co-administered on the same calendar
    day or separated by at least 28 days. Intervals > 0 and < 28 days are invalid.

    Rule body will compare administration dates across live-vaccine doses using
    ``rec.source_dose_indices`` into ``ctx.confirmed_doses``.
    """
    return None  # Q5 deferred — no-op until CLINICAL_DECISIONS.md lands


def _stub_rotavirus_age_cutoff(rec: Recommendation, ctx: ClinicalContext) -> ValidationResult | None:
    """HATHOR-AGE-003 — rotavirus_age_cutoff — STUB.

    Blocked on Q6 (CLINICAL_DECISIONS.md): validates Rotavirus dose recommendations
    against the age cutoff policy. Dose 1 must be given before 105 days (15 weeks);
    the full series must complete before 240 days (8 months) for most products.
    Exact cutoff thresholds are pending physician authorship.
    """
    return None  # Q6 deferred — no-op until CLINICAL_DECISIONS.md lands


def _stub_contraindication_source_conflict(rec: Recommendation, ctx: ClinicalContext) -> ValidationResult | None:
    """HATHOR-CONTRA-001 — contraindication_source_conflict — STUB.

    Blocked on Q11 (CLINICAL_DECISIONS.md): when contraindication sources conflict
    for a given antigen, applies the physician-authored resolution precedence.

    Rule ID is HATHOR-CONTRA-001 (not EG-CONTRA-001) because the precedence
    resolution algorithm is Hathor-project-authored. Egypt MoH is one of the sources
    being adjudicated, not the author of the resolution logic.

    The stub accepts ``source_verdicts: list[dict]`` — each entry is:
        {"source": str, "verdict": bool, "reason": str}
    so the Q11 answer can specify precedence across any number of sources without
    an interface change to this rule.
    """
    return None  # Q11 deferred — no-op until CLINICAL_DECISIONS.md lands


# ── Rule registry ─────────────────────────────────────────────────────────────

_RULE_REGISTRY: list[RuleFn] = [
    _rule_min_age_valid,
    _rule_max_dose_count,
    _rule_min_interval_met,
    _rule_antigen_in_scope,
    _rule_component_antigen_satisfaction,   # Q2 — IMPLEMENTED
    _stub_acip_grace_period,                # Q4 — STUB
    _stub_live_vaccine_coadmin,             # Q5 — STUB
    _stub_rotavirus_age_cutoff,             # Q6 — STUB
    _stub_contraindication_source_conflict, # Q11 — STUB
]

# ── Output dataclass ──────────────────────────────────────────────────────────


@dataclass
class PhaseEOutput:
    """Full output of phase_e.gate() — both active and Provenance audit sets."""

    active: list[ValidationResult]       # results presented to clinician / forwarded to FHIR
    superseded: list[ValidationResult]   # results suppressed by a superseding rule; log to Provenance
    has_failures: bool

    @property
    def all_results(self) -> list[ValidationResult]:
        """Full audit set (active + superseded) for FHIR Provenance logging."""
        return self.active + self.superseded


# ── Public API ────────────────────────────────────────────────────────────────


def validate(recommendations: list[Recommendation], ctx: ClinicalContext) -> list[ValidationResult]:
    """Run all rules; return active ValidationResults (superseded results excluded).

    Prefer ``gate()`` when you need both active and superseded results for Provenance.
    """
    return gate(recommendations, ctx).active


def gate(recommendations: list[Recommendation], ctx: ClinicalContext) -> PhaseEOutput:
    """Full Phase E gate: validate all recommendations and apply supersession logic.

    For each recommendation, every rule in _RULE_REGISTRY fires. Rules returning
    None are skipped (stub rules; inapplicable rules). After all rules fire for a
    recommendation, supersession is applied:

      If result B declares ``supersedes="HATHOR-DOSE-002"``, the HATHOR-DOSE-002
      result is moved to ``superseded`` and B stands in ``active``. Both are
      available for FHIR Provenance logging.
    """
    active: list[ValidationResult] = []
    superseded: list[ValidationResult] = []

    for rec in recommendations:
        raw: list[ValidationResult] = []
        for rule_fn in _RULE_REGISTRY:
            result = rule_fn(rec, ctx)
            if result is not None:
                raw.append(result)

        # Collect all rule_ids that are declared superseded
        superseded_ids: set[str] = {
            r.supersedes for r in raw if r.supersedes is not None
        }

        for result in raw:
            if result.rule_id in superseded_ids:
                superseded.append(result)
            else:
                active.append(result)

    return PhaseEOutput(
        active=active,
        superseded=superseded,
        has_failures=any(r.severity == "fail" for r in active),
    )
