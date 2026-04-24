"""Phase E — Reasoning Safety Loop (per-recommendation).

Validates agent-emitted Recommendation objects against deterministic clinical rules
before they reach the clinician UI or the FHIR bundle. No LLM calls. No hardcoded
pipeline. This is the output boundary gate.

Rule registry (9 rules — 9 implemented, 0 stubs):

  HATHOR-AGE-001    min_age_valid                       IMPLEMENTED
  HATHOR-DOSE-001   max_dose_count                      IMPLEMENTED
  HATHOR-DOSE-002   min_interval_met                    IMPLEMENTED
  HATHOR-AGE-002    antigen_in_scope                    IMPLEMENTED
  HATHOR-EPI-001    component_antigen_satisfaction      IMPLEMENTED (Q2)
  HATHOR-DOSE-003   acip_grace_period                   IMPLEMENTED (Q4)
  HATHOR-EPI-002    live_vaccine_coadmin                IMPLEMENTED (Q5)
  HATHOR-AGE-003    rotavirus_age_cutoff                IMPLEMENTED (Q6)
  EG-CONTRA-001     contraindication_source_conflict    IMPLEMENTED (Q11)

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

from hathor.schemas.recommendation import (
    OVERRIDE_JUSTIFICATION_CODES,
    Recommendation,
    ValidationResult,
)
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

# ── ACIP 4-day grace period constant (Q4 — resolved) ─────────────────────────

#: Doses administered 1–GRACE_PERIOD_DAYS days before the minimum age or minimum
#: interval are counted as valid. Doses 5+ days early must be repeated.
#: Exception: birth-dose antigens where effective_min_age ≤ 28 days.
#: See docs/CLINICAL_DECISIONS.md Q4 for full clinical rationale.
GRACE_PERIOD_DAYS: int = 4

# ── Live vaccine co-administration constants (Q5 — resolved) ─────────────────

#: Oral live vaccines — exempt from the 28-day inter-live-vaccine rule.
#: Oral live vaccines do not produce sufficient systemic interferon response to
#: interfere with other live vaccines; they may be administered simultaneously
#: with or at any interval before or after other live vaccines.
#: See docs/CLINICAL_DECISIONS.md Q5 for the full clinical rationale.
LIVE_ORAL_VACCINES: frozenset[str] = frozenset({
    "OPV",       # oral polio vaccine (both bOPV and tOPV)
    "Rotavirus", # all WHO-prequalified rotavirus products are oral
})

#: Live parenteral (injectable or intranasal) vaccines — subject to the 28-day
#: inter-live-vaccine rule when administered on different days from each other.
#: Includes component antigens that appear as individual confirmed doses (e.g.,
#: monovalent Measles) as well as combination live products (MMR, MMRV).
#: Same-day co-administration of any two live parenterals is valid.
LIVE_PARENTERAL_VACCINES: frozenset[str] = frozenset({
    "MMR", "MR", "MMRV",               # live viral, injectable
    "Varicella",                        # live viral, injectable
    "YellowFever",                      # live viral, injectable (out of Phase 1 scope, included for future)
    "Measles", "Mumps", "Rubella",      # monovalent or decomposed component doses
    "BCG",                              # live bacterial, intradermal (parenteral per WHO definition)
})

#: Minimum interval (days) between different live parenteral vaccines administered
#: on different days. Interferon-mediated interference may impair the second dose.
#: ACIP and WHO align on 28 days. The 4-day grace period (HATHOR-DOSE-003) does
#: NOT apply to this window. Same-antigen intra-series intervals use DOSE-002.
LIVE_COADMIN_MIN_DAYS: int = 28

# ── High-burden source countries (Friction by Design — HATHOR-AGE-003) ───────

#: Countries where WHO child-mortality stratum indicates very high under-5 mortality.
#: When ``ClinicalContext.source_country`` matches a country in this set, HATHOR-AGE-003
#: returns ``override_required`` (Friction by Design) rather than plain ``fail`` for
#: rotavirus age-cutoff violations. Phase 1 validated source country: Nigeria.
#: List is non-exhaustive — extend as clinical scope expands.
#: See docs/CLINICAL_DECISIONS.md § Clinical UI Policy — Friction by Design.
HIGH_BURDEN_COUNTRIES: frozenset[str] = frozenset({
    # Phase 1 validated source country
    "Nigeria",
    # Sahel / West Africa
    "Sudan", "Chad", "Niger", "Mali", "Burkina Faso",
    "Guinea", "Guinea-Bissau", "Sierra Leone", "Liberia",
    "Côte d'Ivoire", "Ivory Coast", "Benin", "Togo", "Senegal",
    # Central Africa
    "South Sudan", "Democratic Republic of the Congo", "DRC", "Congo",
    "Central African Republic", "Cameroon",
    # East Africa
    "Ethiopia", "Somalia", "Uganda", "Tanzania", "Rwanda", "Burundi",
    # Southern Africa
    "Mozambique", "Angola", "Malawi", "Zambia", "Zimbabwe",
})

# ── Rotavirus age cutoff constants (Q6 — resolved) ────────────────────────────

#: Minimum age for Rotavirus dose 1 (ACIP): 6 weeks = 42 days.
ROTAVIRUS_MIN_AGE_DAYS: int = 42

#: Maximum age at which Rotavirus dose 1 may be INITIATED (ACIP): 14 weeks
#: 6 days = 104 days; doses from 15 weeks 0 days onward (≥ 105 days) are past
#: the cutoff. Violations return warn severity (migrant-child advisory path).
ROTAVIRUS_DOSE1_MAX_AGE_DAYS: int = 105   # ≥ this value triggers the cutoff

#: Maximum age by which all Rotavirus doses must be COMPLETED (ACIP/WHO): 8
#: months. Doses administered at or after this age return fail severity.
#: Using 8 × 30 days = 240. ACIP calendar-month definition varies slightly;
#: 240 is the conservative (strict) interpretation.
ROTAVIRUS_SERIES_MAX_AGE_DAYS: int = 240  # ≥ this value triggers fail

# ── Contraindication source precedence (Q11 — resolved) ──────────────────────

#: Ordered precedence list for EG-CONTRA-001. Index 0 = highest precedence.
#: "Strictest wins" — if ANY applicable source marks an (antigen, condition)
#: pair as contraindicated, the recommendation fails. The precedence list
#: determines which source's reasoning appears in the fail rationale.
#: See docs/CLINICAL_DECISIONS.md Q11 for the full decision.
_CONTRA_SOURCE_PRECEDENCE: list[str] = ["EgyptMoH", "ManufacturerLabel", "WHO-DAK"]

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
    """Normalize pertussis-containing antigen spellings to a single canonical token.

    Per Q2 decision: wP and aP are interchangeable for primary series completion.
    The engine uses "DPT" as the canonical pertussis token for age/interval lookups
    because Egypt's EPI uses DTPw whole-cell — the normalized token matches the
    Egypt schedule keys.

    Variants handled:
      - wP acronym-order:  "DTP", "DTwP"  → "DPT"
      - aP:                "DTaP", "DT"   → "DPT"

    Agents have been observed to emit "DTP" (clinically equivalent to "DPT", only
    the acronym letter order differs) non-deterministically across runs. Collapsing
    these variants here stabilises downstream set-membership checks (notably
    HATHOR-AGE-002 antigen_in_scope) against that naming variance.
    """
    if antigen in ("DTaP", "DT", "DTP", "DTwP"):
        return "DPT"
    return antigen


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

    ``source_country`` is the patient's country of origin (ISO or common name).
    Used by HATHOR-AGE-003 (Friction by Design contextual trigger): when the patient
    arrives from a country in HIGH_BURDEN_COUNTRIES, age-cutoff violations return
    ``override_required`` rather than ``fail``. Empty string = unknown/not applicable.

    ``current_date`` is the reference date for patient-state calculations (e.g., the
    child's current age in gap-mode rules — see § Gap-mode convention below).
    Defaults to ``date.today()``. Injectable so tests and deterministic replays can
    pin the evaluation date without touching system time.
    """

    child_dob: date
    target_country: str
    source_country: str = ""               # patient's country of origin (Friction by Design trigger)
    confirmed_doses: list[dict] = field(default_factory=list)
    current_date: date = field(default_factory=date.today)  # reference date for gap-mode evaluation


# ── Gap-mode convention (Recommendation.source_dose_indices == []) ────────────
#
# A recommendation may be emitted with ``source_dose_indices = []`` (an explicit
# empty list, NOT an omitted field) to signal GAP-MODE evaluation: the finding
# is the *absence* of a dose rather than a verdict on a specific administered
# dose. The rule should reason from patient state (``ctx.child_dob``,
# ``ctx.current_date``, ``ctx.source_country``, and the full ``ctx.confirmed_doses``
# list) rather than indexing into ``confirmed_doses``.
#
# Convention for rule authors:
# 1. A rule that has OPTED IN to gap-mode must detect the empty-list signal and
#    branch to its gap-mode evaluation path (see ``_rule_rotavirus_age_cutoff``
#    for the reference implementation).
# 2. A rule that has NOT opted in must return ``None`` when
#    ``rec.source_dose_indices == []`` — this matches the existing guard
#    (``if not rec.source_dose_indices: return None``) and ensures the rule
#    cannot spuriously fire on a gap-mode recommendation intended for a
#    different rule.
# 3. Rule authors SHOULD document their gap-mode support (or lack of it) in the
#    rule docstring. Silently ignoring a gap-mode signal is safe; silently
#    firing against empty indices is a bug.
#
# This convention lets gap-mode recommendations address findings like "the
# rotavirus window has closed for this migrant child with no prior doses — emit
# the high-burden-origin override pathway" (HATHOR-AGE-003, Q6) and "this
# condition contraindicates the antigen even though no dose has been given"
# (EG-CONTRA-001 future-dose case) without forcing the agent to invent a fake
# confirmed dose to satisfy the indexing requirement.


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
            "Dose may need to be repeated; HATHOR-DOSE-003 will assess ACIP 4-day grace."
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

    Antigen names are normalised via _normalize_pertussis before the set-membership
    check so pertussis acronym-order variants ("DTP" vs "DPT", "DTwP") and aP variants
    ("DTaP", "DT") all resolve to the same canonical scope verdict. This stabilises
    HATHOR-AGE-002 against agent-side naming variance — scope is a rule-layer
    responsibility, not the agent's.
    """
    normalized = _normalize_pertussis(rec.antigen)
    if normalized in PHASE1_ANTIGENS:
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


def _rule_acip_grace_period(rec: Recommendation, ctx: ClinicalContext) -> ValidationResult | None:
    """HATHOR-DOSE-003 — acip_grace_period.

    Doses administered 1–4 days before the minimum age or minimum interval are
    counted as valid under the ACIP 4-day grace period (``GRACE_PERIOD_DAYS``).
    Doses 5+ days early must be repeated.

    Supersession semantics:
    - Interval shortfall 1–4 days: returns pass, supersedes="HATHOR-DOSE-002".
    - Age shortfall 1–4 days (and effective_min_age > 28): returns pass,
      supersedes="HATHOR-AGE-001".
    - Interval supersession takes priority. When both age and interval are
      simultaneously within the grace window, only interval grace fires — the age
      fail (HATHOR-AGE-001) remains active. This is a known design limitation;
      clinician override is the resolution path. See CLINICAL_DECISIONS.md Q4.

    Birth-dose exception: the grace period does NOT apply when the Egypt-schedule
    effective minimum age for (antigen, dose_number) is ≤ 28 days. This covers
    birth-dose HepB and BCG. Strict minimums apply for neonatal immunology reasons.

    Chained grace: actual administration dates are used throughout (not notional
    "earliest valid" dates), so grace does not compound across a series.

    Returns None when:
    - rec.kind is not "dose_verdict"
    - No violation exists (actual interval/age meets or exceeds the minimum)
    - Shortfall exceeds GRACE_PERIOD_DAYS (dose must be repeated; fail stands)
    - Insufficient data to compute the shortfall (missing dates or indices)

    See docs/CLINICAL_DECISIONS.md Q4 for the full clinical rationale.
    """
    if rec.kind != "dose_verdict":
        return None
    if rec.dose_number is None:
        return None

    # ── Interval grace (supersedes HATHOR-DOSE-002) ───────────────────────────
    # Mirrors _rule_min_interval_met: use source_dose_indices[-1] / [-2] for
    # current and prior doses so both rules evaluate the identical interval.
    if rec.dose_number >= 2 and len(rec.source_dose_indices) >= 2:
        current_idx = rec.source_dose_indices[-1]
        prior_idx = rec.source_dose_indices[-2]

        if current_idx < len(ctx.confirmed_doses) and prior_idx < len(ctx.confirmed_doses):
            current_date_str = ctx.confirmed_doses[current_idx].get("date_administered")
            prior_date_str = ctx.confirmed_doses[prior_idx].get("date_administered")

            if current_date_str and prior_date_str:
                try:
                    current_date = datetime.fromisoformat(current_date_str).date()
                    prior_date = datetime.fromisoformat(prior_date_str).date()
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

                    interval_shortfall = min_interval - actual_interval
                    if 0 < interval_shortfall <= GRACE_PERIOD_DAYS:
                        return ValidationResult(
                            recommendation_id=rec.recommendation_id,
                            severity="pass",
                            rule_id="HATHOR-DOSE-003",
                            rule_slug="acip_grace_period",
                            rule_rationale=(
                                f"Interval of {actual_interval} days is {interval_shortfall} day(s) "
                                f"short of the {min_interval}-day minimum for {rec.antigen} "
                                f"doses {from_dose}→{rec.dose_number} ({source}). "
                                f"Within the ACIP {GRACE_PERIOD_DAYS}-day grace window — "
                                "dose counts as valid."
                            ),
                            supersedes="HATHOR-DOSE-002",
                        )
                    # interval_shortfall ≤ 0: no interval violation; fall through to age check.
                    # interval_shortfall > GRACE_PERIOD_DAYS: outside grace; DOSE-002 fail
                    # stands. Still fall through — age may independently be within grace.
                except ValueError:
                    pass

    # ── Age grace (supersedes HATHOR-AGE-001) ────────────────────────────────
    # Mirrors _rule_min_age_valid index convention: source_dose_indices[0] for the
    # dose being evaluated in a dose_verdict context.
    if rec.source_dose_indices:
        idx = rec.source_dose_indices[0]
        if idx < len(ctx.confirmed_doses):
            date_str = ctx.confirmed_doses[idx].get("date_administered")
            if date_str:
                try:
                    dose_date = datetime.fromisoformat(date_str).date()
                    age_days = (dose_date - ctx.child_dob).days

                    # Egypt min age (Q3 — preferred); fall back to ACIP/DAK default
                    eg_key = (rec.antigen, rec.dose_number)
                    if eg_key in _EG_MIN_AGE_DAYS:
                        effective_min_age = _EG_MIN_AGE_DAYS[eg_key]
                        age_source = "Egypt EPI schedule"
                    else:
                        effective_min_age = MIN_AGE_DAYS.get(rec.antigen, 42)
                        age_source = "ACIP/DAK default"

                    # Birth-dose exception: grace does not apply for min age ≤ 28 days.
                    if effective_min_age <= 28:
                        return None

                    age_shortfall = effective_min_age - age_days
                    if 0 < age_shortfall <= GRACE_PERIOD_DAYS:
                        return ValidationResult(
                            recommendation_id=rec.recommendation_id,
                            severity="pass",
                            rule_id="HATHOR-DOSE-003",
                            rule_slug="acip_grace_period",
                            rule_rationale=(
                                f"Age of {age_days} days is {age_shortfall} day(s) below "
                                f"the {effective_min_age}-day minimum for {rec.antigen} "
                                f"dose {rec.dose_number} ({age_source}). "
                                f"Within the ACIP {GRACE_PERIOD_DAYS}-day grace window — "
                                "dose counts as valid."
                            ),
                            supersedes="HATHOR-AGE-001",
                        )
                    # age_shortfall ≤ 0: no age violation; > GRACE_PERIOD_DAYS: outside grace.
                except ValueError:
                    pass

    return None


def _rule_live_vaccine_coadmin(rec: Recommendation, ctx: ClinicalContext) -> ValidationResult | None:
    """HATHOR-EPI-002 — live_vaccine_coadmin.

    Two different live parenteral (injectable or intranasal) vaccines administered
    on different days must be separated by ≥28 days (LIVE_COADMIN_MIN_DAYS). When
    the interval is shorter, the second dose (the later one) is invalid.

    Exemptions:
    - Live ORAL vaccines (OPV, Rotavirus) are exempt — no minimum interval with
      any other live vaccine.
    - Same-day co-administration of two live parenterals is always valid.
    - Same-antigen intra-series doses (e.g., MMR dose 1 → MMR dose 2) are
      handled by HATHOR-DOSE-002/003, not this rule.

    The 4-day grace period (HATHOR-DOSE-003) does NOT apply to this 28-day
    inter-live window. HATHOR-EPI-002 does not supersede and is not superseded.

    Biological-event rule (Q2 dependency): a combination live vaccine dose (e.g.,
    MMR) preserved in confirmed_doses governs 28-day spacing as its original
    product type. Decomposition into component-antigen satisfactions (HATHOR-EPI-001)
    does not erase the biological event.

    Applies to: dose_verdict for live parenteral antigens.
    Returns None for: non-dose_verdict kinds, oral live vaccines, non-live antigens,
    missing source indices or confirmed dose data.

    See docs/CLINICAL_DECISIONS.md Q5 for the full clinical rationale.
    """
    if rec.kind != "dose_verdict":
        return None
    if rec.antigen not in LIVE_PARENTERAL_VACCINES:
        return None  # oral live vaccines and non-live vaccines: rule does not apply
    if not rec.source_dose_indices:
        return None

    current_idx = rec.source_dose_indices[-1]
    if current_idx >= len(ctx.confirmed_doses):
        return None

    date_str = ctx.confirmed_doses[current_idx].get("date_administered")
    if not date_str:
        return None

    try:
        current_date = datetime.fromisoformat(date_str).date()
    except ValueError:
        return None

    # Scan all confirmed doses for other live parenteral vaccines
    for i, other_dose in enumerate(ctx.confirmed_doses):
        if i == current_idx:
            continue

        other_antigen = other_dose.get("antigen", "")

        # Skip same-antigen doses — intra-series, handled by DOSE-002/003
        if other_antigen == rec.antigen:
            continue

        # Skip oral live vaccines and non-live vaccines (exempt)
        if other_antigen not in LIVE_PARENTERAL_VACCINES:
            continue

        other_date_str = other_dose.get("date_administered")
        if not other_date_str:
            continue

        try:
            other_date = datetime.fromisoformat(other_date_str).date()
        except ValueError:
            continue

        interval = (current_date - other_date).days

        # Same day: co-administration always valid
        if interval == 0:
            continue

        # Current dose is the SECOND (later): check the 28-day minimum
        if 0 < interval < LIVE_COADMIN_MIN_DAYS:
            return ValidationResult(
                recommendation_id=rec.recommendation_id,
                severity="fail",
                rule_id="HATHOR-EPI-002",
                rule_slug="live_vaccine_coadmin",
                rule_rationale=(
                    f"{rec.antigen} (live parenteral) was administered {interval} day(s) "
                    f"after {other_antigen} (live parenteral) — below the {LIVE_COADMIN_MIN_DAYS}-day "
                    "minimum inter-live-vaccine interval. The second dose is invalid and must be "
                    f"re-administered ≥{LIVE_COADMIN_MIN_DAYS} days after "
                    f"{current_date.isoformat()}. "
                    "The ACIP 4-day grace (HATHOR-DOSE-003) does not apply to this window."
                ),
            )
        # interval < 0: current dose is the FIRST; the later dose (if invalid) fails on its own.
        # interval >= 28: adequate spacing.

    return ValidationResult(
        recommendation_id=rec.recommendation_id,
        severity="pass",
        rule_id="HATHOR-EPI-002",
        rule_slug="live_vaccine_coadmin",
        rule_rationale=(
            f"{rec.antigen} (live parenteral): no inter-live-vaccine spacing violation found. "
            "Same-day co-administration is valid; live oral vaccines (OPV, Rotavirus) are exempt. "
            "Same-antigen intra-series intervals are evaluated by HATHOR-DOSE-002."
        ),
    )


def _rule_rotavirus_age_cutoff(rec: Recommendation, ctx: ClinicalContext) -> ValidationResult | None:
    """HATHOR-AGE-003 — rotavirus_age_cutoff.

    ACIP age thresholds for Rotavirus (adopted as Hathor default per Q6):

      Min age dose 1:     6 weeks    = 42 days  (ROTAVIRUS_MIN_AGE_DAYS)
      Max age dose 1:    15 weeks 0 days = 105 days cutoff (ROTAVIRUS_DOSE1_MAX_AGE_DAYS)
      Max series age:     8 months   = 240 days (ROTAVIRUS_SERIES_MAX_AGE_DAYS)

    Severity logic — amended per Friction by Design clinical UI policy:
    - Dose 1 at <42 days:
        → fail (below minimum age; independent of source country)
    - Any dose at ≥240 days, patient from HIGH_BURDEN_COUNTRIES:
        → override_required (Friction by Design; structured justification required)
    - Any dose at ≥240 days, patient NOT from HIGH_BURDEN_COUNTRIES:
        → fail
    - Dose 1 at ≥105 days AND <240 days, patient from HIGH_BURDEN_COUNTRIES:
        → override_required (migrant advisory — structured justification required)
    - Dose 1 at ≥105 days AND <240 days, patient NOT from HIGH_BURDEN_COUNTRIES:
        → fail
    - Dose 2+ at ≥105 days AND <240 days:
        → pass (dose-1 cutoff applies to dose-1 initiation only; subsequent doses
                evaluated on the 8-month completion cutoff only, per ACIP)
    - Otherwise: pass.

    **Gap mode** — this rule opts into the ``source_dose_indices == []``
    convention (see § Gap-mode convention above). When the recommendation is
    emitted with an empty indices list AND no Rotavirus dose exists in
    ``ctx.confirmed_doses``, the rule reasons from patient state:

      - Current age (``ctx.current_date - ctx.child_dob``) > 105 days AND
        ``ctx.source_country ∈ HIGH_BURDEN_COUNTRIES``:
            → override_required with HIGH_BURDEN_ORIGIN / OUTBREAK_CATCHUP /
              CLINICIAN_DETERMINED justification codes (Friction by Design).
      - Current age > 105 days AND source country is NOT high-burden:
            → fail (Q6 policy: past-cutoff, non-high-burden → no catch-up).
      - Current age ≤ 105 days:
            → None (window still open; other rules handle in-window gaps).

    Gap mode is skipped if the child already has a confirmed Rotavirus dose —
    that case is the present-dose path above, evaluated against the dose's
    administration date.

    override_required rules use distinct UI treatment (not standard yellow warning),
    present available justification codes to the clinician, and log both the code and
    free-text to FHIR Provenance. See CLINICAL_DECISIONS.md § Clinical UI Policy.

    Preterm infants: ACIP uses chronological age; Hathor uses chronological age.

    Returns None for non-Rotavirus antigens and non-dose_verdict kinds.
    See docs/CLINICAL_DECISIONS.md Q6 (rule) and § Clinical UI Policy (amendment).
    """
    if rec.antigen != "Rotavirus":
        return None
    if rec.kind != "dose_verdict":
        return None
    if rec.dose_number is None:
        return None

    high_burden = ctx.source_country in HIGH_BURDEN_COUNTRIES

    # ── Gap-mode path (source_dose_indices == []) ───────────────────────────
    # Evaluate against patient state when no backing dose is indexed. Skipped
    # when a Rotavirus dose already exists in confirmed_doses — that falls to
    # the present-dose path below, which remains unchanged.
    if rec.source_dose_indices == []:
        has_rotavirus_dose = any(
            d.get("antigen") == "Rotavirus" for d in ctx.confirmed_doses
        )
        if has_rotavirus_dose:
            return None  # present-dose path applies; gap mode not relevant

        current_age_days = (ctx.current_date - ctx.child_dob).days

        if current_age_days <= ROTAVIRUS_DOSE1_MAX_AGE_DAYS:
            # Window still open — this rule doesn't fire on in-window gaps;
            # other rules (or the agent's catch-up planner) handle this case.
            return None

        if high_burden:
            return ValidationResult(
                recommendation_id=rec.recommendation_id,
                severity="override_required",
                rule_id="HATHOR-AGE-003",
                rule_slug="rotavirus_age_cutoff",
                rule_rationale=(
                    f"No confirmed Rotavirus dose for a child currently "
                    f"{current_age_days} days old — past the ACIP dose-1 "
                    f"initiation cutoff of {ROTAVIRUS_DOSE1_MAX_AGE_DAYS} days "
                    "(15 weeks 0 days). "
                    f"Patient origin ({ctx.source_country}) is a high-rotavirus-"
                    "mortality setting. WHO benefit-risk analyses support a "
                    "structured override decision (~154 rotavirus deaths "
                    "prevented per intussusception risk). Clinician must select "
                    "a justification code and document the clinical rationale — "
                    "both logged to FHIR Provenance. Distinct visual treatment "
                    "applies (Friction by Design)."
                ),
                override_justification_codes=sorted(OVERRIDE_JUSTIFICATION_CODES),
            )
        return ValidationResult(
            recommendation_id=rec.recommendation_id,
            severity="fail",
            rule_id="HATHOR-AGE-003",
            rule_slug="rotavirus_age_cutoff",
            rule_rationale=(
                f"No confirmed Rotavirus dose for a child currently "
                f"{current_age_days} days old — past the ACIP dose-1 "
                f"initiation cutoff of {ROTAVIRUS_DOSE1_MAX_AGE_DAYS} days "
                "(15 weeks 0 days). "
                f"Source country ({ctx.source_country or 'unknown'}) is not in "
                "the high-rotavirus-mortality stratum. Q6 policy: rotavirus "
                "window closed; no catch-up indicated. Standard clinician "
                "override with documented clinical reason is available."
            ),
        )

    if not rec.source_dose_indices:
        return None

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

    # Dose 1 minimum age: < 6 weeks = fail (independent of source country)
    if rec.dose_number == 1 and age_days < ROTAVIRUS_MIN_AGE_DAYS:
        return ValidationResult(
            recommendation_id=rec.recommendation_id,
            severity="fail",
            rule_id="HATHOR-AGE-003",
            rule_slug="rotavirus_age_cutoff",
            rule_rationale=(
                f"Rotavirus dose 1 at {age_days} days is below the ACIP minimum age of "
                f"{ROTAVIRUS_MIN_AGE_DAYS} days (6 weeks)."
            ),
        )

    # Series completion cutoff: ≥ 8 months (all doses)
    if age_days >= ROTAVIRUS_SERIES_MAX_AGE_DAYS:
        if high_burden:
            return ValidationResult(
                recommendation_id=rec.recommendation_id,
                severity="override_required",
                rule_id="HATHOR-AGE-003",
                rule_slug="rotavirus_age_cutoff",
                rule_rationale=(
                    f"Rotavirus dose {rec.dose_number} at {age_days} days exceeds the "
                    f"ACIP series-completion maximum of {ROTAVIRUS_SERIES_MAX_AGE_DAYS} days "
                    f"(8 months). Patient origin ({ctx.source_country}) is a high-rotavirus-"
                    "mortality setting. WHO benefit-risk analyses support a structured override "
                    "decision — clinician must select a justification code and document the "
                    "clinical rationale. Both are logged to FHIR Provenance. Note: evidence for "
                    "benefit attenuates past 8 months; document accordingly."
                ),
                override_justification_codes=sorted(OVERRIDE_JUSTIFICATION_CODES),
            )
        return ValidationResult(
            recommendation_id=rec.recommendation_id,
            severity="fail",
            rule_id="HATHOR-AGE-003",
            rule_slug="rotavirus_age_cutoff",
            rule_rationale=(
                f"Rotavirus dose {rec.dose_number} at {age_days} days exceeds the "
                f"ACIP series-completion maximum of {ROTAVIRUS_SERIES_MAX_AGE_DAYS} days "
                "(8 months). Override available with documented clinical reason."
            ),
        )

    # Dose 1 max-age cutoff: ≥ 15 weeks 0 days and < 8 months
    if rec.dose_number == 1 and age_days >= ROTAVIRUS_DOSE1_MAX_AGE_DAYS:
        if high_burden:
            return ValidationResult(
                recommendation_id=rec.recommendation_id,
                severity="override_required",
                rule_id="HATHOR-AGE-003",
                rule_slug="rotavirus_age_cutoff",
                rule_rationale=(
                    f"Rotavirus dose 1 at {age_days} days exceeds the ACIP dose-1 initiation "
                    f"cutoff of {ROTAVIRUS_DOSE1_MAX_AGE_DAYS} days (15 weeks 0 days). "
                    f"Patient origin ({ctx.source_country}) is a high-rotavirus-mortality "
                    "setting. WHO benefit-risk analyses support a structured override decision "
                    f"(~154 rotavirus deaths prevented per intussusception risk). Clinician must "
                    "select a justification code and document the clinical rationale — both logged "
                    "to FHIR Provenance. Distinct visual treatment applies (Friction by Design)."
                ),
                override_justification_codes=sorted(OVERRIDE_JUSTIFICATION_CODES),
            )
        return ValidationResult(
            recommendation_id=rec.recommendation_id,
            severity="fail",
            rule_id="HATHOR-AGE-003",
            rule_slug="rotavirus_age_cutoff",
            rule_rationale=(
                f"Rotavirus dose 1 at {age_days} days exceeds the ACIP dose-1 initiation "
                f"cutoff of {ROTAVIRUS_DOSE1_MAX_AGE_DAYS} days (15 weeks 0 days). "
                "ACIP: dose 1 should not be initiated at ≥15 weeks. Override available with "
                "documented clinical reason."
            ),
        )

    return ValidationResult(
        recommendation_id=rec.recommendation_id,
        severity="pass",
        rule_id="HATHOR-AGE-003",
        rule_slug="rotavirus_age_cutoff",
        rule_rationale=(
            f"Rotavirus dose {rec.dose_number} at {age_days} days is within ACIP age "
            f"parameters (min: {ROTAVIRUS_MIN_AGE_DAYS} days; "
            f"dose-1 max: {ROTAVIRUS_DOSE1_MAX_AGE_DAYS} days; "
            f"series max: {ROTAVIRUS_SERIES_MAX_AGE_DAYS} days)."
        ),
    )


def _rule_contraindication_source_conflict(rec: Recommendation, ctx: ClinicalContext) -> ValidationResult | None:
    """EG-CONTRA-001 — contraindication_source_conflict.

    When contraindication source verdicts conflict for a given (antigen, condition)
    pair, this rule applies the Egypt-MoH-sovereign precedence ordering to resolve
    which verdict governs:

        1. Egyptian MoH directive (governs absolutely for Egyptian destination schedule)
        2. Manufacturer label (product-specific; SRA-regulated filing)
        3. WHO DAK / WHO position paper (baseline when the above are silent)

    "Strictest wins" principle: if ANY applicable source marks the (antigen, condition)
    pair as contraindicated (verdict=True), the recommendation fails. A source's
    "precaution" does not downgrade another source's "contraindication." The precedence
    list determines which source's reasoning appears in the fail rationale.

    Source verdicts are provided by the agent via ``Recommendation.source_verdicts``:
        [{"source": "EgyptMoH", "verdict": bool, "reason": str}, ...]
    The rule fires only when source_verdicts is non-empty AND sources disagree. When all
    sources agree (or no verdicts are provided), the rule returns None — no conflict
    to resolve.

    Applies to: contra kind only.
    Returns None for: non-contra kinds, empty source_verdicts, unanimous verdicts.
    See docs/CLINICAL_DECISIONS.md Q11 for the full clinical rationale.
    """
    if rec.kind != "contra":
        return None

    source_verdicts: list[dict] = list(rec.source_verdicts or [])
    if not source_verdicts:
        return None  # no conflict data available — cannot evaluate

    # Extract boolean verdicts; filter entries with a valid verdict key
    verdicts = [sv["verdict"] for sv in source_verdicts if isinstance(sv.get("verdict"), bool)]
    if not verdicts:
        return None
    if len(set(verdicts)) == 1:
        return None  # all sources agree — no conflict to resolve

    # Conflict confirmed. Apply "strictest wins": any contraindicated → fail.
    contra_entries = [sv for sv in source_verdicts if sv.get("verdict") is True]

    if contra_entries:
        # Pick the highest-precedence source that says "contraindicated" for the rationale
        rationale_sv: dict = contra_entries[0]
        for precedence_source in _CONTRA_SOURCE_PRECEDENCE:
            for sv in contra_entries:
                if sv.get("source") == precedence_source:
                    rationale_sv = sv
                    break
            else:
                continue
            break

        return ValidationResult(
            recommendation_id=rec.recommendation_id,
            severity="fail",
            rule_id="EG-CONTRA-001",
            rule_slug="contraindication_source_conflict",
            rule_rationale=(
                f"Source conflict for {rec.antigen}: "
                f"{rationale_sv.get('source', 'authoritative source')} marks as "
                f"contraindicated — {rationale_sv.get('reason', 'reason unspecified')}. "
                "EG-CONTRA-001 strictest-wins rule: any contraindication in any applicable "
                "source triggers a fail. Precedence for rationale: "
                "Egypt MoH > Manufacturer Label > WHO DAK. "
                "Clinician override available with documented clinical reason."
            ),
        )

    # Conflict was between non-absolute verdicts (e.g., precaution vs. safe);
    # no source said "contraindicated" — pass at the strictest available level.
    return ValidationResult(
        recommendation_id=rec.recommendation_id,
        severity="pass",
        rule_id="EG-CONTRA-001",
        rule_slug="contraindication_source_conflict",
        rule_rationale=(
            f"Source conflict for {rec.antigen} resolved under EG-CONTRA-001: "
            "no applicable source marks this as a contraindication (verdict=True). "
            "Strictest available verdict is 'precaution' or 'safe' — no absolute bar."
        ),
    )


# ── Rule registry ─────────────────────────────────────────────────────────────

_RULE_REGISTRY: list[RuleFn] = [
    _rule_min_age_valid,
    _rule_max_dose_count,
    _rule_min_interval_met,
    _rule_antigen_in_scope,
    _rule_component_antigen_satisfaction,      # Q2 — IMPLEMENTED
    _rule_acip_grace_period,                   # Q4 — IMPLEMENTED
    _rule_live_vaccine_coadmin,                # Q5 — IMPLEMENTED
    _rule_rotavirus_age_cutoff,                # Q6 — IMPLEMENTED
    _rule_contraindication_source_conflict,    # Q11 — IMPLEMENTED (EG-CONTRA-001)
]

# ── Output dataclass ──────────────────────────────────────────────────────────


@dataclass
class PhaseEOutput:
    """Full output of phase_e.gate() — both active and Provenance audit sets.

    ``has_failures`` — True when any active result has severity "fail".
    ``has_override_required`` — True when any active result has severity
      "override_required" (Friction by Design structured override pathway).
      The UI applies distinct visual treatment for these results (contextual
      trigger, mandatory justification code, separate FHIR Provenance logging).
    """

    active: list[ValidationResult]       # results presented to clinician / forwarded to FHIR
    superseded: list[ValidationResult]   # results suppressed by a superseding rule; log to Provenance
    has_failures: bool
    has_override_required: bool = False  # Friction by Design: any override_required result in active

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
        has_override_required=any(r.severity == "override_required" for r in active),
    )
