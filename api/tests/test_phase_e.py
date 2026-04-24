"""Tests for Phase E rules engine — all 9 rules implemented.

Covers:
  HATHOR-AGE-001  min_age_valid           (dose_verdict + due/overdue paths)
  HATHOR-DOSE-001 max_dose_count
  HATHOR-DOSE-002 min_interval_met
  HATHOR-AGE-002  antigen_in_scope
  HATHOR-EPI-001  component_antigen_satisfaction   (Q2 — combination vaccines)
  HATHOR-DOSE-003 acip_grace_period               (Q4 — ACIP 4-day grace)
  HATHOR-EPI-002  live_vaccine_coadmin            (Q5 — 28-day inter-live window)
  HATHOR-AGE-003  rotavirus_age_cutoff            (Q6 — ACIP Rotavirus cutoffs)
  EG-CONTRA-001   contraindication_source_conflict (Q11 — Egypt MoH precedence)
  validate()      supersession engine
  gate()          has_failures flag
"""

import unittest
from datetime import date

from hathor.safety.phase_e import (
    COMBINATION_COMPONENTS,
    ClinicalContext,
    GRACE_PERIOD_DAYS,
    HIGH_BURDEN_COUNTRIES,
    LIVE_COADMIN_MIN_DAYS,
    LIVE_ORAL_VACCINES,
    LIVE_PARENTERAL_VACCINES,
    PhaseEOutput,
    PHASE1_ANTIGENS,
    ROTAVIRUS_DOSE1_MAX_AGE_DAYS,
    ROTAVIRUS_MIN_AGE_DAYS,
    ROTAVIRUS_SERIES_MAX_AGE_DAYS,
    _rule_acip_grace_period,
    _rule_antigen_in_scope,
    _rule_component_antigen_satisfaction,
    _rule_contraindication_source_conflict,
    _rule_live_vaccine_coadmin,
    _rule_max_dose_count,
    _rule_min_age_valid,
    _rule_min_interval_met,
    _rule_rotavirus_age_cutoff,
    gate,
    validate,
)
from hathor.schemas.recommendation import (
    OVERRIDE_JUSTIFICATION_CODES,
    Recommendation,
    ValidationResult,
)


# ── Helpers ───────────────────────────────────────────────────────────────────


def _rec(
    *,
    rec_id: str = "rec-001",
    kind: str = "dose_verdict",
    antigen: str = "MMR",
    dose_number: int | None = 1,
    target_date: date | None = None,
    source_dose_indices: list[int] | None = None,
    agent_confidence: float = 0.9,
) -> Recommendation:
    return Recommendation(
        recommendation_id=rec_id,
        kind=kind,
        antigen=antigen,
        dose_number=dose_number,
        target_date=target_date,
        agent_rationale="test rationale",
        reasoning="test reasoning",
        agent_confidence=agent_confidence,
        source_dose_indices=source_dose_indices or [],
    )


def _ctx(
    *,
    child_dob: date = date(2024, 1, 1),
    target_country: str = "Egypt",
    confirmed_doses: list[dict] | None = None,
) -> ClinicalContext:
    return ClinicalContext(
        child_dob=child_dob,
        target_country=target_country,
        confirmed_doses=confirmed_doses or [],
    )


# ── HATHOR-AGE-001 — min_age_valid ────────────────────────────────────────────


class TestMinAgeValid(unittest.TestCase):

    def test_dose_verdict_passes_when_age_meets_minimum(self):
        # Child DOB 2024-01-01. MMR dose 1: Egypt min = 12 months * 30 = 360 days.
        # Administered 2025-01-26 → 390 days ≥ 360. Expect pass.
        ctx = _ctx(
            child_dob=date(2024, 1, 1),
            confirmed_doses=[{"antigen": "MMR", "date_administered": "2025-01-26", "dose_number": 1}],
        )
        rec = _rec(antigen="MMR", dose_number=1, kind="dose_verdict", source_dose_indices=[0])
        result = _rule_min_age_valid(rec, ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "pass")
        self.assertEqual(result.rule_id, "HATHOR-AGE-001")
        self.assertEqual(result.rule_slug, "min_age_valid")

    def test_dose_verdict_fails_when_age_below_minimum(self):
        # Child DOB 2024-01-01. MMR at 2024-07-01 → 182 days < 360. Expect fail.
        ctx = _ctx(
            child_dob=date(2024, 1, 1),
            confirmed_doses=[{"antigen": "MMR", "date_administered": "2024-07-01", "dose_number": 1}],
        )
        rec = _rec(antigen="MMR", dose_number=1, kind="dose_verdict", source_dose_indices=[0])
        result = _rule_min_age_valid(rec, ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "fail")
        self.assertEqual(result.rule_id, "HATHOR-AGE-001")

    def test_due_passes_via_target_date(self):
        # Child DOB 2024-01-01. Target date 2025-02-01 → 397 days ≥ 360. Expect pass.
        ctx = _ctx(child_dob=date(2024, 1, 1))
        rec = _rec(antigen="MMR", dose_number=1, kind="due", target_date=date(2025, 2, 1))
        result = _rule_min_age_valid(rec, ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "pass")

    def test_due_fails_via_target_date(self):
        # Child DOB 2024-01-01. Target date 2024-06-01 → 152 days < 360. Expect fail.
        ctx = _ctx(child_dob=date(2024, 1, 1))
        rec = _rec(antigen="MMR", dose_number=1, kind="due", target_date=date(2024, 6, 1))
        result = _rule_min_age_valid(rec, ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "fail")

    def test_contra_not_applicable(self):
        # contra kind — rule does not apply.
        ctx = _ctx()
        rec = _rec(antigen="MMR", dose_number=1, kind="contra")
        self.assertIsNone(_rule_min_age_valid(rec, ctx))

    def test_none_dose_number_not_applicable(self):
        ctx = _ctx()
        rec = _rec(antigen="MMR", dose_number=None, kind="catchup_visit")
        self.assertIsNone(_rule_min_age_valid(rec, ctx))

    def test_no_source_index_and_no_target_date_returns_none(self):
        # dose_verdict with no source_dose_indices and no target_date — can't evaluate.
        ctx = _ctx()
        rec = _rec(antigen="MMR", dose_number=1, kind="dose_verdict", source_dose_indices=[])
        self.assertIsNone(_rule_min_age_valid(rec, ctx))

    def test_out_of_range_index_returns_none(self):
        ctx = _ctx(confirmed_doses=[])
        rec = _rec(antigen="MMR", dose_number=1, kind="dose_verdict", source_dose_indices=[5])
        self.assertIsNone(_rule_min_age_valid(rec, ctx))

    def test_acip_fallback_for_unknown_antigen(self):
        # "UnknownAntigen" not in Egypt schedule — falls back to ACIP default (42 days).
        # Child age at dose = 50 days > 42 → pass.
        ctx = _ctx(
            child_dob=date(2024, 1, 1),
            confirmed_doses=[{"antigen": "UnknownAntigen", "date_administered": "2024-02-20", "dose_number": 1}],
        )
        rec = _rec(antigen="UnknownAntigen", dose_number=1, kind="dose_verdict", source_dose_indices=[0])
        result = _rule_min_age_valid(rec, ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "pass")


# ── HATHOR-DOSE-001 — max_dose_count ─────────────────────────────────────────


class TestMaxDoseCount(unittest.TestCase):

    def test_passes_within_maximum(self):
        # Egypt schedule has MMR dose_number 1 and 2. Dose 1 ≤ 2 → pass.
        ctx = _ctx()
        rec = _rec(antigen="MMR", dose_number=1, kind="dose_verdict")
        result = _rule_max_dose_count(rec, ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "pass")
        self.assertEqual(result.rule_id, "HATHOR-DOSE-001")
        self.assertEqual(result.rule_slug, "max_dose_count")

    def test_passes_at_maximum(self):
        # Egypt schedule has MMR max = 2. Dose 2 = max → pass.
        ctx = _ctx()
        rec = _rec(antigen="MMR", dose_number=2, kind="due")
        result = _rule_max_dose_count(rec, ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "pass")

    def test_fails_above_maximum(self):
        # Egypt schedule has MMR max = 2. Dose 3 > 2 → fail.
        ctx = _ctx()
        rec = _rec(antigen="MMR", dose_number=3, kind="due")
        result = _rule_max_dose_count(rec, ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "fail")
        self.assertEqual(result.rule_id, "HATHOR-DOSE-001")

    def test_none_dose_number_not_applicable(self):
        ctx = _ctx()
        rec = _rec(antigen="MMR", dose_number=None, kind="catchup_visit")
        self.assertIsNone(_rule_max_dose_count(rec, ctx))

    def test_antigen_not_in_egypt_schedule_not_applicable(self):
        # "UnknownAntigen" not in Egypt schedule — antigen_in_scope handles this.
        ctx = _ctx()
        rec = _rec(antigen="UnknownAntigen", dose_number=1, kind="dose_verdict")
        self.assertIsNone(_rule_max_dose_count(rec, ctx))

    def test_hexavalent_max_dose(self):
        # Egypt schedule has Hexavalent doses 1, 2, 3. Dose 4 → fail.
        ctx = _ctx()
        rec = _rec(antigen="Hexavalent", dose_number=4, kind="due")
        result = _rule_max_dose_count(rec, ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "fail")


# ── HATHOR-DOSE-002 — min_interval_met ───────────────────────────────────────


class TestMinIntervalMet(unittest.TestCase):

    def _two_dose_ctx(self, prior_date: str, current_date: str) -> ClinicalContext:
        return _ctx(
            child_dob=date(2024, 1, 1),
            confirmed_doses=[
                {"antigen": "MMR", "date_administered": prior_date, "dose_number": 1},
                {"antigen": "MMR", "date_administered": current_date, "dose_number": 2},
            ],
        )

    def test_passes_when_interval_meets_minimum(self):
        # MMR: standard_min_days = 28 (ACIP). 35 days ≥ 28 → pass.
        ctx = self._two_dose_ctx("2025-01-01", "2025-02-05")
        rec = _rec(antigen="MMR", dose_number=2, kind="dose_verdict", source_dose_indices=[0, 1])
        result = _rule_min_interval_met(rec, ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "pass")
        self.assertEqual(result.rule_id, "HATHOR-DOSE-002")
        self.assertEqual(result.rule_slug, "min_interval_met")

    def test_fails_when_interval_below_minimum(self):
        # 14 days < 28 → fail.
        ctx = self._two_dose_ctx("2025-01-01", "2025-01-15")
        rec = _rec(antigen="MMR", dose_number=2, kind="dose_verdict", source_dose_indices=[0, 1])
        result = _rule_min_interval_met(rec, ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "fail")
        self.assertEqual(result.rule_id, "HATHOR-DOSE-002")

    def test_not_applicable_for_first_dose(self):
        ctx = self._two_dose_ctx("2025-01-01", "2025-02-05")
        rec = _rec(antigen="MMR", dose_number=1, kind="dose_verdict", source_dose_indices=[0])
        self.assertIsNone(_rule_min_interval_met(rec, ctx))

    def test_not_applicable_for_non_dose_verdict(self):
        ctx = self._two_dose_ctx("2025-01-01", "2025-02-05")
        rec = _rec(antigen="MMR", dose_number=2, kind="due", source_dose_indices=[0, 1])
        self.assertIsNone(_rule_min_interval_met(rec, ctx))

    def test_not_applicable_when_fewer_than_two_indices(self):
        ctx = self._two_dose_ctx("2025-01-01", "2025-02-05")
        rec = _rec(antigen="MMR", dose_number=2, kind="dose_verdict", source_dose_indices=[1])
        self.assertIsNone(_rule_min_interval_met(rec, ctx))

    def test_egypt_interval_rule_takes_precedence(self):
        # Hexavalent: Egypt interval dose 1→2 = 56 days. 40 days < 56 → fail.
        ctx = _ctx(
            child_dob=date(2024, 1, 1),
            confirmed_doses=[
                {"antigen": "Hexavalent", "date_administered": "2024-03-01", "dose_number": 1},
                {"antigen": "Hexavalent", "date_administered": "2024-04-10", "dose_number": 2},
            ],
        )
        rec = _rec(antigen="Hexavalent", dose_number=2, kind="dose_verdict", source_dose_indices=[0, 1])
        result = _rule_min_interval_met(rec, ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "fail")
        self.assertIn("Egypt", result.rule_rationale)

    def test_egypt_interval_passes_at_threshold(self):
        # Hexavalent: Egypt interval dose 1→2 = 56 days. Exactly 56 → pass.
        ctx = _ctx(
            child_dob=date(2024, 1, 1),
            confirmed_doses=[
                {"antigen": "Hexavalent", "date_administered": "2024-03-01", "dose_number": 1},
                {"antigen": "Hexavalent", "date_administered": "2024-04-26", "dose_number": 2},
            ],
        )
        rec = _rec(antigen="Hexavalent", dose_number=2, kind="dose_verdict", source_dose_indices=[0, 1])
        result = _rule_min_interval_met(rec, ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "pass")


# ── HATHOR-AGE-002 — antigen_in_scope ────────────────────────────────────────


class TestAntigenInScope(unittest.TestCase):

    def test_passes_for_in_scope_antigen(self):
        ctx = _ctx()
        for antigen in ["MMR", "BCG", "OPV", "Hexavalent", "HepB", "IPV", "Pentavalent"]:
            with self.subTest(antigen=antigen):
                rec = _rec(antigen=antigen, kind="dose_verdict")
                result = _rule_antigen_in_scope(rec, ctx)
                self.assertIsNotNone(result)
                self.assertEqual(result.severity, "pass")
                self.assertEqual(result.rule_id, "HATHOR-AGE-002")
                self.assertEqual(result.rule_slug, "antigen_in_scope")

    def test_fails_for_out_of_scope_antigen(self):
        ctx = _ctx()
        for antigen in ["STIKO-only", "InfluenzaQuadrivalent", "Dengue"]:
            with self.subTest(antigen=antigen):
                rec = _rec(antigen=antigen, kind="due")
                result = _rule_antigen_in_scope(rec, ctx)
                self.assertIsNotNone(result)
                self.assertEqual(result.severity, "fail")
                self.assertEqual(result.rule_id, "HATHOR-AGE-002")
                self.assertIn("prompt drift", result.rule_rationale)

    def test_phase1_antigens_constant_is_nonempty(self):
        self.assertGreater(len(PHASE1_ANTIGENS), 10)
        self.assertIn("MMR", PHASE1_ANTIGENS)
        self.assertIn("Hexavalent", PHASE1_ANTIGENS)
        self.assertIn("Pentavalent", PHASE1_ANTIGENS)

    def test_dtp_acronym_variant_normalised_to_in_scope(self):
        # "DTP" is clinically equivalent to "DPT" — only the acronym letter order differs.
        # Phase 1 scope includes DPT; normalisation must keep both spellings in scope so
        # the same clinical scenario does not flip between pass/fail across agent runs.
        ctx = _ctx()
        for variant in ("DTP", "DTwP", "DTaP", "DT", "DPT"):
            with self.subTest(variant=variant):
                rec = _rec(antigen=variant, kind="dose_verdict")
                result = _rule_antigen_in_scope(rec, ctx)
                self.assertIsNotNone(result)
                self.assertEqual(result.severity, "pass", f"{variant} must resolve in-scope")


# ── Stub rules return None ────────────────────────────────────────────────────


# ── HATHOR-EPI-001 — component_antigen_satisfaction ───────────────────────────


class TestComponentAntigenSatisfaction(unittest.TestCase):

    def _hexavalent_ctx(self, admin_date: str, child_dob: date = date(2024, 1, 1)) -> ClinicalContext:
        return _ctx(
            child_dob=child_dob,
            confirmed_doses=[{"antigen": "Hexavalent", "date_administered": admin_date, "dose_number": 1}],
        )

    def test_hexavalent_dose1_at_correct_age_passes(self):
        # Egypt min for Hexavalent dose 1 = 2 months * 30 = 60 days.
        # Child DOB 2024-01-01, dose at 2024-03-10 = 69 days ≥ 60. Expect pass.
        ctx = self._hexavalent_ctx("2024-03-10")
        rec = _rec(antigen="Hexavalent", dose_number=1, kind="dose_verdict", source_dose_indices=[0])
        result = _rule_component_antigen_satisfaction(rec, ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "pass")
        self.assertEqual(result.rule_id, "HATHOR-EPI-001")
        self.assertEqual(result.rule_slug, "component_antigen_satisfaction")
        # All 4 components mentioned in rationale
        self.assertIn("4 component antigens", result.rule_rationale)
        self.assertIn("wP/aP interchangeable", result.rule_rationale)

    def test_hexavalent_dose1_below_min_age_fails(self):
        # Child DOB 2024-01-01, dose at 2024-02-01 = 31 days < 60. Expect fail.
        ctx = self._hexavalent_ctx("2024-02-01")
        rec = _rec(antigen="Hexavalent", dose_number=1, kind="dose_verdict", source_dose_indices=[0])
        result = _rule_component_antigen_satisfaction(rec, ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "fail")
        self.assertEqual(result.rule_id, "HATHOR-EPI-001")
        self.assertIn("below minimum", result.rule_rationale)

    def test_hexavalent_dose2_interval_too_short_fails(self):
        # Hexavalent Egypt interval dose 1→2 = 56 days. 30 days < 56 → fail.
        ctx = _ctx(
            child_dob=date(2024, 1, 1),
            confirmed_doses=[
                {"antigen": "Hexavalent", "date_administered": "2024-03-10", "dose_number": 1},
                {"antigen": "Hexavalent", "date_administered": "2024-04-09", "dose_number": 2},
            ],
        )
        rec = _rec(antigen="Hexavalent", dose_number=2, kind="dose_verdict", source_dose_indices=[0, 1])
        result = _rule_component_antigen_satisfaction(rec, ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "fail")
        self.assertIn("interval", result.rule_rationale)

    def test_hexavalent_dose2_sufficient_interval_passes(self):
        # 56-day interval (exact Egypt minimum for Hexavalent 1→2). Expect pass.
        ctx = _ctx(
            child_dob=date(2024, 1, 1),
            confirmed_doses=[
                {"antigen": "Hexavalent", "date_administered": "2024-03-10", "dose_number": 1},
                {"antigen": "Hexavalent", "date_administered": "2024-05-05", "dose_number": 2},
            ],
        )
        rec = _rec(antigen="Hexavalent", dose_number=2, kind="dose_verdict", source_dose_indices=[0, 1])
        result = _rule_component_antigen_satisfaction(rec, ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "pass")

    def test_mmr_dose1_at_correct_age_passes(self):
        # Egypt min for MMR dose 1 = 12 months * 30 = 360 days.
        # Child DOB 2024-01-01, dose at 2025-01-20 = 384 days ≥ 360.
        ctx = _ctx(
            child_dob=date(2024, 1, 1),
            confirmed_doses=[{"antigen": "MMR", "date_administered": "2025-01-20", "dose_number": 1}],
        )
        rec = _rec(antigen="MMR", dose_number=1, kind="dose_verdict", source_dose_indices=[0])
        result = _rule_component_antigen_satisfaction(rec, ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "pass")
        self.assertIn("3 component antigens", result.rule_rationale)

    def test_pentavalent_dose1_passes(self):
        # Pentavalent: components DPT, HepB, Hib (3 components, no IPV).
        # Min age fallback to ACIP default (42 days). Child at 50 days → pass.
        ctx = _ctx(
            child_dob=date(2024, 1, 1),
            confirmed_doses=[{"antigen": "Pentavalent", "date_administered": "2024-02-20", "dose_number": 1}],
        )
        rec = _rec(antigen="Pentavalent", dose_number=1, kind="dose_verdict", source_dose_indices=[0])
        result = _rule_component_antigen_satisfaction(rec, ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "pass")
        self.assertIn("3 component antigens", result.rule_rationale)

    def test_monovalent_antigen_not_applicable(self):
        # Monovalent DTaP — not in COMBINATION_COMPONENTS → rule returns None.
        ctx = _ctx()
        rec = _rec(antigen="DTaP", dose_number=1, kind="dose_verdict", source_dose_indices=[0])
        self.assertIsNone(_rule_component_antigen_satisfaction(rec, ctx))

    def test_unknown_antigen_not_applicable(self):
        ctx = _ctx()
        rec = _rec(antigen="UnknownCombo", dose_number=1, kind="dose_verdict", source_dose_indices=[0])
        self.assertIsNone(_rule_component_antigen_satisfaction(rec, ctx))

    def test_non_dose_verdict_not_applicable(self):
        ctx = _ctx()
        for kind in ("due", "overdue", "catchup_visit", "contra"):
            with self.subTest(kind=kind):
                rec = _rec(antigen="Hexavalent", dose_number=1, kind=kind)
                self.assertIsNone(_rule_component_antigen_satisfaction(rec, ctx))

    def test_no_source_indices_not_applicable(self):
        ctx = _ctx()
        rec = _rec(antigen="Hexavalent", dose_number=1, kind="dose_verdict", source_dose_indices=[])
        self.assertIsNone(_rule_component_antigen_satisfaction(rec, ctx))

    def test_combination_components_map_exported(self):
        self.assertIn("Hexavalent", COMBINATION_COMPONENTS)
        self.assertIn("MMR", COMBINATION_COMPONENTS)
        self.assertIn("Pentavalent", COMBINATION_COMPONENTS)
        hex_components = COMBINATION_COMPONENTS["Hexavalent"]
        self.assertIn("DPT", hex_components)
        self.assertIn("IPV", hex_components)
        self.assertIn("HepB", hex_components)
        self.assertIn("Hib", hex_components)
        # Pentavalent should NOT include IPV
        self.assertNotIn("IPV", COMBINATION_COMPONENTS["Pentavalent"])


# ── HATHOR-DOSE-003 — acip_grace_period ──────────────────────────────────────


class TestGracePeriod(unittest.TestCase):
    """ACIP 4-day grace period — Q4 physician decision implemented."""

    # Helpers: MMR dose 2 interval scenarios
    # MMR standard_min_days = 28 (ACIP default; Egypt schedule has no explicit
    # MMR-to-MMR interval rule, so ACIP 28-day default applies).
    _DOB = date(2024, 1, 1)
    _DOSE1_DATE = "2025-02-01"  # well past MMR dose 1 age minimum (360 days)

    def _mmr_dose2_ctx(self, dose2_date: str) -> ClinicalContext:
        return _ctx(
            child_dob=self._DOB,
            confirmed_doses=[
                {"antigen": "MMR", "date_administered": self._DOSE1_DATE, "dose_number": 1},
                {"antigen": "MMR", "date_administered": dose2_date, "dose_number": 2},
            ],
        )

    def _mmr_dose2_rec(self) -> Recommendation:
        return _rec(antigen="MMR", dose_number=2, kind="dose_verdict", source_dose_indices=[0, 1])

    # ── Interval grace ────────────────────────────────────────────────────────

    def test_interval_grace_applies_at_4_days_short(self):
        # 24-day interval, min 28, shortfall 4 ≤ GRACE_PERIOD_DAYS → pass
        ctx = self._mmr_dose2_ctx("2025-02-25")  # 24 days after dose 1
        rec = self._mmr_dose2_rec()
        result = _rule_acip_grace_period(rec, ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "pass")
        self.assertEqual(result.rule_id, "HATHOR-DOSE-003")
        self.assertEqual(result.rule_slug, "acip_grace_period")
        self.assertEqual(result.supersedes, "HATHOR-DOSE-002")
        self.assertIn("grace", result.rule_rationale)
        self.assertIn("4 day(s)", result.rule_rationale)

    def test_interval_grace_applies_at_1_day_short(self):
        # 27-day interval, shortfall 1 → also within grace
        ctx = self._mmr_dose2_ctx("2025-02-28")  # 27 days after dose 1
        rec = self._mmr_dose2_rec()
        result = _rule_acip_grace_period(rec, ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "pass")
        self.assertEqual(result.supersedes, "HATHOR-DOSE-002")
        self.assertIn("1 day(s)", result.rule_rationale)

    def test_interval_grace_does_not_apply_at_5_days_short(self):
        # 23-day interval, shortfall 5 > GRACE_PERIOD_DAYS → None (outside grace)
        ctx = self._mmr_dose2_ctx("2025-02-24")  # 23 days after dose 1
        rec = self._mmr_dose2_rec()
        self.assertIsNone(_rule_acip_grace_period(rec, ctx))

    def test_interval_no_violation_returns_none(self):
        # 28-day interval, shortfall 0 — no violation; grace does not apply
        ctx = self._mmr_dose2_ctx("2025-03-01")  # exactly 28 days after dose 1
        rec = self._mmr_dose2_rec()
        self.assertIsNone(_rule_acip_grace_period(rec, ctx))

    def test_interval_exceeds_minimum_returns_none(self):
        # 35-day interval — well within schedule; nothing for grace to do
        ctx = self._mmr_dose2_ctx("2025-03-08")  # 35 days after dose 1
        rec = self._mmr_dose2_rec()
        self.assertIsNone(_rule_acip_grace_period(rec, ctx))

    # ── Age grace ─────────────────────────────────────────────────────────────

    # Egypt min for MMR dose 1 = 12 months × 30 = 360 days.
    # Child DOB 2024-01-01. 360 days later = 2024-12-26.
    # Within grace: 356 days (shortfall 4) = 2024-12-22.
    # Outside grace: 355 days (shortfall 5) = 2024-12-21.

    def test_age_grace_applies_at_4_days_short(self):
        # 356 days old (min 360, shortfall 4 ≤ GRACE_PERIOD_DAYS) → pass
        ctx = _ctx(
            child_dob=date(2024, 1, 1),
            confirmed_doses=[{"antigen": "MMR", "date_administered": "2024-12-22", "dose_number": 1}],
        )
        rec = _rec(antigen="MMR", dose_number=1, kind="dose_verdict", source_dose_indices=[0])
        result = _rule_acip_grace_period(rec, ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "pass")
        self.assertEqual(result.rule_id, "HATHOR-DOSE-003")
        self.assertEqual(result.supersedes, "HATHOR-AGE-001")
        self.assertIn("grace", result.rule_rationale)

    def test_age_grace_applies_at_1_day_short(self):
        # 359 days old (shortfall 1) → within grace
        ctx = _ctx(
            child_dob=date(2024, 1, 1),
            confirmed_doses=[{"antigen": "MMR", "date_administered": "2024-12-25", "dose_number": 1}],
        )
        rec = _rec(antigen="MMR", dose_number=1, kind="dose_verdict", source_dose_indices=[0])
        result = _rule_acip_grace_period(rec, ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "pass")
        self.assertEqual(result.supersedes, "HATHOR-AGE-001")

    def test_age_grace_does_not_apply_at_5_days_short(self):
        # 355 days old (shortfall 5 > GRACE_PERIOD_DAYS) → None
        ctx = _ctx(
            child_dob=date(2024, 1, 1),
            confirmed_doses=[{"antigen": "MMR", "date_administered": "2024-12-21", "dose_number": 1}],
        )
        rec = _rec(antigen="MMR", dose_number=1, kind="dose_verdict", source_dose_indices=[0])
        self.assertIsNone(_rule_acip_grace_period(rec, ctx))

    def test_age_no_violation_returns_none(self):
        # 360 days old (exactly at minimum, shortfall 0) — no violation
        ctx = _ctx(
            child_dob=date(2024, 1, 1),
            confirmed_doses=[{"antigen": "MMR", "date_administered": "2024-12-26", "dose_number": 1}],
        )
        rec = _rec(antigen="MMR", dose_number=1, kind="dose_verdict", source_dose_indices=[0])
        self.assertIsNone(_rule_acip_grace_period(rec, ctx))

    def test_birth_dose_exception_no_age_grace(self):
        """Grace does not apply when effective_min_age ≤ 28 (birth-dose antigens)."""
        from hathor.safety import phase_e as pe_mod
        original = dict(pe_mod._EG_MIN_AGE_DAYS)
        try:
            # Inject a birth-dose-like antigen with min_age = 14 days
            pe_mod._EG_MIN_AGE_DAYS[("BirthTestAntigen", 1)] = 14
            ctx = _ctx(
                child_dob=date(2024, 1, 1),
                confirmed_doses=[
                    {"antigen": "BirthTestAntigen", "date_administered": "2024-01-12", "dose_number": 1}
                ],
            )
            rec = _rec(
                antigen="BirthTestAntigen", dose_number=1, kind="dose_verdict",
                source_dose_indices=[0],
            )
            # Age = 11 days, min = 14 days, shortfall = 3 (within grace range)
            # BUT min_age ≤ 28 → birth-dose exception → must return None
            result = _rule_acip_grace_period(rec, ctx)
            self.assertIsNone(result)
        finally:
            pe_mod._EG_MIN_AGE_DAYS.clear()
            pe_mod._EG_MIN_AGE_DAYS.update(original)

    # ── Kind guard ────────────────────────────────────────────────────────────

    def test_not_applicable_for_non_dose_verdict(self):
        ctx = _ctx()
        for kind in ("due", "overdue", "catchup_visit", "contra"):
            with self.subTest(kind=kind):
                rec = _rec(antigen="MMR", dose_number=1, kind=kind)
                self.assertIsNone(_rule_acip_grace_period(rec, ctx))

    def test_not_applicable_for_none_dose_number(self):
        ctx = _ctx()
        rec = _rec(antigen="MMR", dose_number=None, kind="dose_verdict")
        self.assertIsNone(_rule_acip_grace_period(rec, ctx))

    # ── Grace period constant ─────────────────────────────────────────────────

    def test_grace_period_days_constant(self):
        self.assertEqual(GRACE_PERIOD_DAYS, 4)

    # ── End-to-end gate() supersession with real DOSE-003 rule ───────────────

    def test_real_dose003_supersedes_dose002_in_gate(self):
        """gate() moves HATHOR-DOSE-002 fail to superseded when DOSE-003 grace applies."""
        from hathor.safety import phase_e as pe_mod
        ctx = _ctx(
            child_dob=date(2024, 1, 1),
            confirmed_doses=[
                {"antigen": "MMR", "date_administered": "2025-02-01", "dose_number": 1},
                {"antigen": "MMR", "date_administered": "2025-02-25", "dose_number": 2},  # 24 days < 28
            ],
        )
        rec = _rec(
            antigen="MMR", dose_number=2, kind="dose_verdict",
            source_dose_indices=[0, 1], rec_id="rec-grace-e2e",
        )
        original = pe_mod._RULE_REGISTRY[:]
        try:
            # Isolate to just the two rules under test to avoid EPI-001 noise
            pe_mod._RULE_REGISTRY = [pe_mod._rule_min_interval_met, pe_mod._rule_acip_grace_period]
            output = gate([rec], ctx)
        finally:
            pe_mod._RULE_REGISTRY = original

        superseded_ids = {r.rule_id for r in output.superseded}
        active_ids = {r.rule_id for r in output.active}
        self.assertIn("HATHOR-DOSE-002", superseded_ids, "DOSE-002 fail must be superseded")
        self.assertIn("HATHOR-DOSE-003", active_ids, "DOSE-003 pass must be active")
        self.assertNotIn("HATHOR-DOSE-002", active_ids)
        self.assertFalse(output.has_failures)


# ── Stub rules return None ────────────────────────────────────────────────────


# ── HATHOR-EPI-002 — live_vaccine_coadmin ────────────────────────────────────


class TestLiveVaccineCoadmin(unittest.TestCase):
    """28-day inter-live-vaccine rule — Q5 physician decision implemented."""

    _DOB = date(2024, 1, 1)

    def _mmr_ctx(self, mmr_date: str, other_antigen: str, other_date: str) -> ClinicalContext:
        return _ctx(
            child_dob=self._DOB,
            confirmed_doses=[
                {"antigen": other_antigen, "date_administered": other_date, "dose_number": 1},
                {"antigen": "MMR", "date_administered": mmr_date, "dose_number": 1},
            ],
        )

    def test_same_day_coadmin_passes(self):
        # Same-day co-administration of two live parenterals is always valid.
        ctx = self._mmr_ctx("2025-01-26", "Varicella", "2025-01-26")
        rec = _rec(antigen="MMR", dose_number=1, kind="dose_verdict", source_dose_indices=[1])
        result = _rule_live_vaccine_coadmin(rec, ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "pass")
        self.assertEqual(result.rule_id, "HATHOR-EPI-002")

    def test_interval_14_days_fails(self):
        # MMR given 14 days after Varicella: second dose (MMR) is invalid.
        ctx = self._mmr_ctx("2025-02-09", "Varicella", "2025-01-26")  # 14 days apart
        rec = _rec(antigen="MMR", dose_number=1, kind="dose_verdict", source_dose_indices=[1])
        result = _rule_live_vaccine_coadmin(rec, ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "fail")
        self.assertEqual(result.rule_id, "HATHOR-EPI-002")
        self.assertIn("14 day(s)", result.rule_rationale)
        self.assertIn("Varicella", result.rule_rationale)

    def test_interval_exactly_28_days_passes(self):
        # Exactly 28 days apart — meets the minimum.
        ctx = self._mmr_ctx("2025-02-23", "Varicella", "2025-01-26")  # exactly 28 days
        rec = _rec(antigen="MMR", dose_number=1, kind="dose_verdict", source_dose_indices=[1])
        result = _rule_live_vaccine_coadmin(rec, ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "pass")

    def test_interval_27_days_fails(self):
        # 27 days apart — 1 day short; the 4-day grace does NOT apply here.
        ctx = self._mmr_ctx("2025-02-22", "Varicella", "2025-01-26")  # 27 days
        rec = _rec(antigen="MMR", dose_number=1, kind="dose_verdict", source_dose_indices=[1])
        result = _rule_live_vaccine_coadmin(rec, ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "fail")
        self.assertIn("4-day grace", result.rule_rationale)

    def test_current_dose_is_first_passes(self):
        # MMR comes BEFORE Varicella — current (MMR) is the first; no violation.
        ctx = _ctx(
            child_dob=self._DOB,
            confirmed_doses=[
                {"antigen": "MMR", "date_administered": "2025-01-26", "dose_number": 1},
                {"antigen": "Varicella", "date_administered": "2025-02-09", "dose_number": 1},
            ],
        )
        rec = _rec(antigen="MMR", dose_number=1, kind="dose_verdict", source_dose_indices=[0])
        result = _rule_live_vaccine_coadmin(rec, ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "pass")

    def test_live_oral_exempt(self):
        # OPV (live oral) + MMR at any interval: no violation; OPV is exempt.
        ctx = _ctx(
            child_dob=self._DOB,
            confirmed_doses=[
                {"antigen": "OPV", "date_administered": "2025-01-26", "dose_number": 1},
                {"antigen": "MMR", "date_administered": "2025-02-09", "dose_number": 1},  # 14 days
            ],
        )
        rec = _rec(antigen="MMR", dose_number=1, kind="dose_verdict", source_dose_indices=[1])
        result = _rule_live_vaccine_coadmin(rec, ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "pass")

    def test_rotavirus_exempt(self):
        # Rotavirus (live oral) + MMR at 10 days: exempt; no violation.
        ctx = _ctx(
            child_dob=self._DOB,
            confirmed_doses=[
                {"antigen": "Rotavirus", "date_administered": "2025-01-16", "dose_number": 1},
                {"antigen": "MMR", "date_administered": "2025-01-26", "dose_number": 1},
            ],
        )
        rec = _rec(antigen="MMR", dose_number=1, kind="dose_verdict", source_dose_indices=[1])
        result = _rule_live_vaccine_coadmin(rec, ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "pass")

    def test_non_live_antigen_returns_none(self):
        # Hexavalent is not live — rule does not apply.
        ctx = _ctx()
        rec = _rec(antigen="Hexavalent", dose_number=1, kind="dose_verdict", source_dose_indices=[0])
        self.assertIsNone(_rule_live_vaccine_coadmin(rec, ctx))

    def test_same_antigen_intra_series_passes(self):
        # MMR dose 1 and MMR dose 2 within 28 days: same antigen (intra-series), DOSE-002 handles.
        ctx = _ctx(
            child_dob=self._DOB,
            confirmed_doses=[
                {"antigen": "MMR", "date_administered": "2025-01-26", "dose_number": 1},
                {"antigen": "MMR", "date_administered": "2025-02-09", "dose_number": 2},
            ],
        )
        rec = _rec(antigen="MMR", dose_number=2, kind="dose_verdict", source_dose_indices=[0, 1])
        result = _rule_live_vaccine_coadmin(rec, ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "pass")  # same antigen skipped; no other live vaccines

    def test_non_dose_verdict_returns_none(self):
        ctx = _ctx()
        for kind in ("due", "overdue", "catchup_visit", "contra"):
            with self.subTest(kind=kind):
                rec = _rec(antigen="MMR", dose_number=1, kind=kind)
                self.assertIsNone(_rule_live_vaccine_coadmin(rec, ctx))

    def test_constants_exported(self):
        self.assertEqual(LIVE_COADMIN_MIN_DAYS, 28)
        self.assertIn("OPV", LIVE_ORAL_VACCINES)
        self.assertIn("Rotavirus", LIVE_ORAL_VACCINES)
        self.assertIn("MMR", LIVE_PARENTERAL_VACCINES)
        self.assertIn("Varicella", LIVE_PARENTERAL_VACCINES)
        self.assertNotIn("Hexavalent", LIVE_PARENTERAL_VACCINES)
        self.assertNotIn("OPV", LIVE_PARENTERAL_VACCINES)


# ── HATHOR-AGE-003 — rotavirus_age_cutoff ────────────────────────────────────


class TestRotavirusAgeCutoff(unittest.TestCase):
    """ACIP Rotavirus age cutoffs — Q6 physician decision implemented.

    Egypt EPI / ACIP thresholds:
      Min age dose 1:   42 days (6 weeks)       — FAIL below minimum (any source country)
      Max age dose 1:  105 days (15 weeks 0 d)  — FAIL (non-high-burden) / OVERRIDE_REQUIRED (high-burden)
      Max series age:  240 days (8 months)       — FAIL (non-high-burden) / OVERRIDE_REQUIRED (high-burden)

    Friction by Design amendment (Clinical UI Policy):
      When source_country ∈ HIGH_BURDEN_COUNTRIES, dose-1 max-age and series-max violations
      return override_required with justification codes rather than plain fail. The UI applies
      distinct visual treatment and requires a structured justification code from the clinician.
    """

    _DOB = date(2024, 1, 1)

    def _rota_ctx(self, admin_date: str, dose_number: int = 1, source_country: str = "") -> ClinicalContext:
        return ClinicalContext(
            child_dob=self._DOB,
            target_country="Egypt",
            source_country=source_country,
            confirmed_doses=[
                {"antigen": "Rotavirus", "date_administered": admin_date, "dose_number": dose_number}
            ],
        )

    def _rota_rec(self, dose_number: int = 1) -> Recommendation:
        return _rec(antigen="Rotavirus", dose_number=dose_number, kind="dose_verdict", source_dose_indices=[0])

    # ── Pass cases ────────────────────────────────────────────────────────────

    def test_dose1_at_min_age_passes(self):
        # 42 days old — exactly at minimum age.
        ctx = self._rota_ctx("2024-02-12")  # DOB 2024-01-01, +42 days
        result = _rule_rotavirus_age_cutoff(self._rota_rec(), ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "pass")
        self.assertEqual(result.rule_id, "HATHOR-AGE-003")

    def test_dose1_within_window_passes(self):
        # 70 days old — within 42–104 day window.
        ctx = self._rota_ctx("2024-03-11")  # 70 days
        result = _rule_rotavirus_age_cutoff(self._rota_rec(), ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "pass")

    def test_dose1_at_104_days_passes(self):
        # 104 days = last day before cutoff — still pass.
        ctx = self._rota_ctx("2024-04-14")  # 104 days
        result = _rule_rotavirus_age_cutoff(self._rota_rec(), ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "pass")

    def test_dose2_above_dose1_cutoff_but_below_series_max_passes(self):
        # Dose 2 at 120 days — dose-1 cutoff does NOT apply to dose ≥2.
        ctx = self._rota_ctx("2024-05-01", dose_number=2)  # ~121 days
        result = _rule_rotavirus_age_cutoff(self._rota_rec(dose_number=2), ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "pass")

    # ── Fail cases: dose-1 max-age, non-high-burden ──────────────────────────

    def test_dose1_at_105_days_non_high_burden_fails(self):
        # 105 days = exactly at the dose-1 cutoff threshold.
        # source_country="" (unknown/non-high-burden) → FAIL.
        ctx = self._rota_ctx("2024-04-15")  # 105 days; source_country="" default
        result = _rule_rotavirus_age_cutoff(self._rota_rec(), ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "fail")
        self.assertEqual(result.rule_id, "HATHOR-AGE-003")
        self.assertIn("cutoff", result.rule_rationale.lower())

    def test_dose1_at_200_days_non_high_burden_fails(self):
        # 200 days — past dose-1 cutoff but < 240-day series max.
        # Non-high-burden → FAIL (not warn).
        ctx = self._rota_ctx("2024-07-19")  # ~200 days; source_country="" default
        result = _rule_rotavirus_age_cutoff(self._rota_rec(), ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "fail")

    # ── Fail cases ────────────────────────────────────────────────────────────

    def test_dose1_below_min_age_fails(self):
        # 41 days — 1 day below minimum → FAIL.
        ctx = self._rota_ctx("2024-02-11")  # 41 days
        result = _rule_rotavirus_age_cutoff(self._rota_rec(), ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "fail")
        self.assertIn("minimum age", result.rule_rationale)

    def test_any_dose_at_series_max_non_high_burden_fails(self):
        # Dose 1 at exactly 240 days, non-high-burden → FAIL (series-completion cutoff).
        ctx = self._rota_ctx("2024-08-28")  # 240 days from 2024-01-01; source_country="" default
        result = _rule_rotavirus_age_cutoff(self._rota_rec(), ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "fail")
        self.assertIn("series-completion", result.rule_rationale)

    def test_dose2_at_series_max_non_high_burden_fails(self):
        # Dose 2 at 250 days, non-high-burden → FAIL.
        ctx = self._rota_ctx("2024-09-07", dose_number=2)  # 250 days; source_country="" default
        result = _rule_rotavirus_age_cutoff(self._rota_rec(dose_number=2), ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "fail")

    # ── High-burden: override_required (Friction by Design) ──────────────────

    def test_dose1_at_105_days_high_burden_override_required(self):
        # 105 days, source_country="Nigeria" (HIGH_BURDEN_COUNTRIES) → OVERRIDE_REQUIRED.
        ctx = self._rota_ctx("2024-04-15", source_country="Nigeria")  # 105 days
        result = _rule_rotavirus_age_cutoff(self._rota_rec(), ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "override_required")
        self.assertEqual(result.rule_id, "HATHOR-AGE-003")
        self.assertIn("Nigeria", result.rule_rationale)

    def test_dose1_at_200_days_high_burden_override_required(self):
        # 200 days, source_country="Nigeria" → OVERRIDE_REQUIRED (dose-1 max cutoff).
        ctx = self._rota_ctx("2024-07-19", source_country="Nigeria")  # ~200 days
        result = _rule_rotavirus_age_cutoff(self._rota_rec(), ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "override_required")

    def test_series_max_high_burden_override_required(self):
        # Dose 1 at exactly 240 days, source_country="Nigeria" → OVERRIDE_REQUIRED.
        ctx = self._rota_ctx("2024-08-28", source_country="Nigeria")  # 240 days
        result = _rule_rotavirus_age_cutoff(self._rota_rec(), ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "override_required")
        self.assertEqual(result.rule_id, "HATHOR-AGE-003")

    def test_dose1_below_min_always_fails_regardless_of_source_country(self):
        # Dose 1 < 42 days is always fail regardless of source country.
        ctx = self._rota_ctx("2024-02-11", source_country="Nigeria")  # 41 days
        result = _rule_rotavirus_age_cutoff(self._rota_rec(), ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "fail")  # min-age violation: never override_required

    def test_override_justification_codes_populated_when_override_required(self):
        # When severity is override_required, override_justification_codes must be non-empty
        # and must be a subset of OVERRIDE_JUSTIFICATION_CODES.
        ctx = self._rota_ctx("2024-04-15", source_country="Nigeria")  # 105 days, high-burden
        result = _rule_rotavirus_age_cutoff(self._rota_rec(), ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "override_required")
        self.assertTrue(len(result.override_justification_codes) > 0)
        for code in result.override_justification_codes:
            self.assertIn(code, OVERRIDE_JUSTIFICATION_CODES)

    def test_override_justification_codes_empty_on_fail(self):
        # Plain fail results must NOT carry justification codes.
        ctx = self._rota_ctx("2024-04-15")  # 105 days, non-high-burden → fail
        result = _rule_rotavirus_age_cutoff(self._rota_rec(), ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "fail")
        self.assertEqual(result.override_justification_codes, [])

    def test_high_burden_countries_constant_includes_nigeria(self):
        # Nigeria is the Phase 1 validated source country.
        self.assertIn("Nigeria", HIGH_BURDEN_COUNTRIES)

    # ── Not applicable ────────────────────────────────────────────────────────

    def test_non_rotavirus_returns_none(self):
        ctx = _ctx()
        rec = _rec(antigen="MMR", dose_number=1, kind="dose_verdict", source_dose_indices=[0])
        self.assertIsNone(_rule_rotavirus_age_cutoff(rec, ctx))

    def test_non_dose_verdict_returns_none(self):
        ctx = _ctx()
        for kind in ("due", "overdue", "catchup_visit", "contra"):
            with self.subTest(kind=kind):
                rec = _rec(antigen="Rotavirus", dose_number=1, kind=kind)
                self.assertIsNone(_rule_rotavirus_age_cutoff(rec, ctx))

    def test_constants_exported(self):
        self.assertEqual(ROTAVIRUS_MIN_AGE_DAYS, 42)
        self.assertEqual(ROTAVIRUS_DOSE1_MAX_AGE_DAYS, 105)
        self.assertEqual(ROTAVIRUS_SERIES_MAX_AGE_DAYS, 240)


# ── HATHOR-AGE-003 gap-mode (source_dose_indices == []) ──────────────────────


class TestRotavirusGapMode(unittest.TestCase):
    """Gap-mode evaluation: no confirmed Rotavirus dose, emit dose_verdict with
    ``source_dose_indices = []``. The rule reasons from patient state
    (``ctx.current_date - ctx.child_dob``) and ``ctx.source_country``.

    See the § Gap-mode convention block in phase_e.py for the general contract.
    """

    _DOB = date(2024, 1, 1)

    def _gap_rec(self) -> Recommendation:
        return _rec(
            antigen="Rotavirus",
            dose_number=1,
            kind="dose_verdict",
            source_dose_indices=[],  # explicit empty list = gap-mode signal
        )

    def _ctx_at_age(
        self,
        age_days: int,
        source_country: str = "",
        confirmed_doses: list[dict] | None = None,
    ) -> ClinicalContext:
        from datetime import timedelta
        return ClinicalContext(
            child_dob=self._DOB,
            target_country="Egypt",
            source_country=source_country,
            confirmed_doses=confirmed_doses or [],
            current_date=self._DOB + timedelta(days=age_days),
        )

    # ── Gap mode: past cutoff ────────────────────────────────────────────────

    def test_nigerian_origin_no_rotavirus_past_cutoff_override_required(self):
        # Nigerian origin, no rotavirus doses, child 120 days old →
        # override_required with three justification codes (HIGH_BURDEN_ORIGIN,
        # OUTBREAK_CATCHUP, CLINICIAN_DETERMINED).
        ctx = self._ctx_at_age(age_days=120, source_country="Nigeria")
        result = _rule_rotavirus_age_cutoff(self._gap_rec(), ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "override_required")
        self.assertEqual(result.rule_id, "HATHOR-AGE-003")
        self.assertIn("Nigeria", result.rule_rationale)
        self.assertEqual(
            set(result.override_justification_codes),
            {"HIGH_BURDEN_ORIGIN", "OUTBREAK_CATCHUP", "CLINICIAN_DETERMINED"},
        )

    def test_non_high_burden_no_rotavirus_past_cutoff_fails(self):
        # Egyptian origin (not in HIGH_BURDEN_COUNTRIES), no rotavirus doses,
        # child 120 days old → fail (Q6 policy: past-cutoff, non-high-burden).
        ctx = self._ctx_at_age(age_days=120, source_country="Egypt")
        result = _rule_rotavirus_age_cutoff(self._gap_rec(), ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "fail")
        self.assertEqual(result.rule_id, "HATHOR-AGE-003")
        self.assertEqual(result.override_justification_codes, [])
        self.assertIn("window closed", result.rule_rationale)

    def test_empty_source_country_no_rotavirus_past_cutoff_fails(self):
        # Unknown source country defaults to non-high-burden → fail.
        ctx = self._ctx_at_age(age_days=120, source_country="")
        result = _rule_rotavirus_age_cutoff(self._gap_rec(), ctx)
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "fail")

    # ── Gap mode: in-window ──────────────────────────────────────────────────

    def test_any_origin_no_rotavirus_within_window_returns_none(self):
        # Child 80 days old, any origin → None (window still open; other rules
        # handle in-window gaps. HATHOR-AGE-003 intentionally stays silent so
        # it doesn't double-report against catch-up planner output).
        for source in ("", "Nigeria", "Egypt", "Ethiopia"):
            with self.subTest(source_country=source):
                ctx = self._ctx_at_age(age_days=80, source_country=source)
                result = _rule_rotavirus_age_cutoff(self._gap_rec(), ctx)
                self.assertIsNone(result)

    def test_cutoff_boundary_at_exactly_105_days_returns_none(self):
        # Age exactly equal to the dose-1 cutoff (105 days) is the last day the
        # window is considered open for gap-mode (strict `>` semantics).
        ctx = self._ctx_at_age(age_days=105, source_country="Nigeria")
        self.assertIsNone(_rule_rotavirus_age_cutoff(self._gap_rec(), ctx))

    # ── Regression: gap-mode must NOT interfere with present-dose path ───────

    def test_present_dose_path_still_fires_with_non_empty_indices(self):
        # Rotavirus dose present at 130 days, non-empty source_dose_indices →
        # the original present-dose evaluation path must fire exactly as before.
        # This is a regression check that the new gap-mode branch hasn't
        # disturbed the existing code.
        ctx = ClinicalContext(
            child_dob=self._DOB,
            target_country="Egypt",
            source_country="Nigeria",
            confirmed_doses=[
                {"antigen": "Rotavirus", "date_administered": "2024-05-11", "dose_number": 1}
            ],
        )
        rec = _rec(
            antigen="Rotavirus",
            dose_number=1,
            kind="dose_verdict",
            source_dose_indices=[0],
        )
        result = _rule_rotavirus_age_cutoff(rec, ctx)
        self.assertIsNotNone(result)
        # 131 days from 2024-01-01 to 2024-05-11 → past the dose-1 cutoff,
        # high-burden origin → override_required (unchanged present-dose path).
        self.assertEqual(result.severity, "override_required")
        self.assertIn("131 days", result.rule_rationale)

    def test_gap_mode_skipped_when_rotavirus_dose_exists(self):
        # Even with source_dose_indices=[], gap mode should NOT fire when a
        # Rotavirus dose exists in confirmed_doses — the agent would normally
        # emit with source_dose_indices=[idx], but defensive-skip protects
        # against a malformed emission where gap-mode is signaled alongside a
        # real dose. Present-dose path owns this case.
        ctx = ClinicalContext(
            child_dob=self._DOB,
            target_country="Egypt",
            source_country="Nigeria",
            confirmed_doses=[
                {"antigen": "Rotavirus", "date_administered": "2024-05-11", "dose_number": 1}
            ],
            current_date=date(2024, 5, 15),
        )
        rec = self._gap_rec()  # empty source_dose_indices
        self.assertIsNone(_rule_rotavirus_age_cutoff(rec, ctx))

    # ── Convention: other rules must NOT spuriously fire on empty indices ────

    def test_other_rules_return_none_on_empty_source_dose_indices(self):
        # Gap-mode convention: rules that have not opted into gap-mode must
        # return None when source_dose_indices == []. Verifies HATHOR-EPI-001
        # (component_antigen_satisfaction) and HATHOR-DOSE-003 (acip_grace_period)
        # specifically — the two rules named in the Q6 clinical-contradiction
        # fix spec that did not opt in.
        ctx = self._ctx_at_age(age_days=120, source_country="Nigeria")
        # HATHOR-EPI-001 — try a combination antigen to exercise the rule's body
        epi_rec = _rec(
            antigen="Hexavalent",
            dose_number=1,
            kind="dose_verdict",
            source_dose_indices=[],
        )
        self.assertIsNone(_rule_component_antigen_satisfaction(epi_rec, ctx))
        # HATHOR-DOSE-003 — dose 2 with empty indices; grace-period rule must
        # not fire against missing data.
        grace_rec = _rec(
            antigen="Hexavalent",
            dose_number=2,
            kind="dose_verdict",
            source_dose_indices=[],
        )
        self.assertIsNone(_rule_acip_grace_period(grace_rec, ctx))


# ── EG-CONTRA-001 — contraindication_source_conflict ─────────────────────────


class TestContraSourceConflict(unittest.TestCase):
    """EG-CONTRA-001 — Egypt MoH precedence for conflicting contraindication verdicts."""

    def _contra_rec(self, source_verdicts: list[dict] | None = None) -> Recommendation:
        from hathor.schemas.recommendation import Recommendation
        return Recommendation(
            recommendation_id="rec-contra",
            kind="contra",
            antigen="MMR",
            agent_rationale="test contra",
            reasoning="test reasoning",
            agent_confidence=0.9,
            source_verdicts=source_verdicts or [],
        )

    def test_no_source_verdicts_returns_none(self):
        # No conflict data — rule cannot evaluate.
        rec = self._contra_rec([])
        self.assertIsNone(_rule_contraindication_source_conflict(rec, _ctx()))

    def test_all_agree_contraindicated_returns_none(self):
        # No conflict — all say contraindicated; no resolution needed.
        rec = self._contra_rec([
            {"source": "EgyptMoH", "verdict": True, "reason": "allergy"},
            {"source": "WHO-DAK", "verdict": True, "reason": "allergy"},
        ])
        self.assertIsNone(_rule_contraindication_source_conflict(rec, _ctx()))

    def test_all_agree_safe_returns_none(self):
        # No conflict — all say safe; no resolution needed.
        rec = self._contra_rec([
            {"source": "EgyptMoH", "verdict": False, "reason": "safe"},
            {"source": "WHO-DAK", "verdict": False, "reason": "safe"},
        ])
        self.assertIsNone(_rule_contraindication_source_conflict(rec, _ctx()))

    def test_conflict_any_contraindicated_fails(self):
        # Egypt says safe, WHO says contraindicated → strictest wins → FAIL.
        rec = self._contra_rec([
            {"source": "EgyptMoH", "verdict": False, "reason": "safe per Egypt directive"},
            {"source": "WHO-DAK", "verdict": True, "reason": "contraindicated per DAK"},
        ])
        result = _rule_contraindication_source_conflict(rec, _ctx())
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "fail")
        self.assertEqual(result.rule_id, "EG-CONTRA-001")
        self.assertEqual(result.rule_slug, "contraindication_source_conflict")
        self.assertIn("WHO-DAK", result.rule_rationale)

    def test_conflict_egypt_contraindicated_fails(self):
        # Egypt says contraindicated, manufacturer says safe → Egypt governs.
        rec = self._contra_rec([
            {"source": "EgyptMoH", "verdict": True, "reason": "Egypt MoH directive 2024"},
            {"source": "ManufacturerLabel", "verdict": False, "reason": "safe per label"},
        ])
        result = _rule_contraindication_source_conflict(rec, _ctx())
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "fail")
        self.assertIn("EgyptMoH", result.rule_rationale)

    def test_conflict_highest_precedence_source_in_rationale(self):
        # Both WHO and Egypt say contraindicated — Egypt (highest precedence) in rationale.
        rec = self._contra_rec([
            {"source": "WHO-DAK", "verdict": True, "reason": "DAK reason"},
            {"source": "EgyptMoH", "verdict": True, "reason": "Egypt reason"},
            {"source": "ManufacturerLabel", "verdict": False, "reason": "safe"},
        ])
        result = _rule_contraindication_source_conflict(rec, _ctx())
        self.assertIsNotNone(result)
        self.assertEqual(result.severity, "fail")
        self.assertIn("EgyptMoH", result.rule_rationale)  # highest precedence cited

    def test_conflict_precaution_vs_safe_passes(self):
        # Conflict between non-absolute verdicts; none say contraindicated → pass.
        rec = self._contra_rec([
            {"source": "EgyptMoH", "verdict": False, "reason": "precaution"},
            {"source": "WHO-DAK", "verdict": False, "reason": "safe"},
        ])
        # All verdicts are False → no conflict (len(set([False])) == 1) → None
        self.assertIsNone(_rule_contraindication_source_conflict(rec, _ctx()))

    def test_non_contra_kind_returns_none(self):
        ctx = _ctx()
        for kind in ("dose_verdict", "due", "overdue", "catchup_visit"):
            with self.subTest(kind=kind):
                rec = _rec(antigen="MMR", dose_number=1, kind=kind)
                self.assertIsNone(_rule_contraindication_source_conflict(rec, ctx))

    def test_override_allowed_is_true(self):
        rec = self._contra_rec([
            {"source": "EgyptMoH", "verdict": True, "reason": "contra"},
            {"source": "WHO-DAK", "verdict": False, "reason": "safe"},
        ])
        result = _rule_contraindication_source_conflict(rec, _ctx())
        self.assertIsNotNone(result)
        self.assertTrue(result.override_allowed)


# ── gate() and validate() ─────────────────────────────────────────────────────


class TestGate(unittest.TestCase):

    def test_validate_returns_active_only(self):
        ctx = _ctx()
        rec = _rec(antigen="MMR", dose_number=1, kind="due", target_date=date(2025, 2, 1),
                   rec_id="rec-001")
        results = validate([rec], ctx)
        self.assertIsInstance(results, list)
        self.assertTrue(all(isinstance(r, ValidationResult) for r in results))

    def test_has_failures_true_when_fail_present(self):
        # antigen out of scope → HATHOR-AGE-002 fail
        ctx = _ctx()
        rec = _rec(antigen="UnknownPathogen", dose_number=1, kind="due", rec_id="rec-001")
        output = gate([rec], ctx)
        self.assertIsInstance(output, PhaseEOutput)
        self.assertTrue(output.has_failures)

    def test_has_failures_false_when_all_pass(self):
        # In-scope antigen, no dose_number context needed for antigen_in_scope
        ctx = _ctx()
        rec = _rec(antigen="MMR", dose_number=None, kind="catchup_visit", rec_id="rec-001")
        output = gate([rec], ctx)
        # max_dose_count skips (dose_number=None); min_interval_met skips (not dose_verdict)
        # min_age_valid skips (dose_number=None); antigen_in_scope passes
        passes = [r for r in output.active if r.severity == "pass"]
        self.assertTrue(len(passes) >= 1)
        self.assertFalse(output.has_failures)

    def test_supersession_moves_result_to_superseded(self):
        # Synthetic: inject a fake result that supersedes HATHOR-AGE-001,
        # then run gate() on a context that would normally produce HATHOR-AGE-001.
        # We verify the supersession logic by calling gate() with a monkeypatched
        # rule that returns a superseding result.
        from hathor.safety import phase_e as pe_mod

        def _fake_superseding_rule(rec, ctx):
            return ValidationResult(
                recommendation_id=rec.recommendation_id,
                severity="pass",
                rule_id="HATHOR-DOSE-003",
                rule_slug="acip_grace_period",
                rule_rationale="Grace period applies — supersedes min_interval_met.",
                supersedes="HATHOR-DOSE-002",
            )

        original_registry = pe_mod._RULE_REGISTRY[:]
        # Add a superseding rule and a rule that would normally fire HATHOR-DOSE-002
        # We'll use the real min_interval_met (which fires a fail for short interval)
        # and the fake grace period rule.
        ctx = _ctx(
            child_dob=date(2024, 1, 1),
            confirmed_doses=[
                {"antigen": "MMR", "date_administered": "2025-01-01", "dose_number": 1},
                {"antigen": "MMR", "date_administered": "2025-01-10", "dose_number": 2},  # 9 days < 28
            ],
        )
        rec = _rec(antigen="MMR", dose_number=2, kind="dose_verdict",
                   source_dose_indices=[0, 1], rec_id="rec-sup")

        try:
            pe_mod._RULE_REGISTRY = [_rule_min_interval_met, _fake_superseding_rule]
            output = gate([rec], ctx)
        finally:
            pe_mod._RULE_REGISTRY = original_registry

        # HATHOR-DOSE-002 should be superseded
        superseded_ids = {r.rule_id for r in output.superseded}
        active_ids = {r.rule_id for r in output.active}
        self.assertIn("HATHOR-DOSE-002", superseded_ids)
        self.assertIn("HATHOR-DOSE-003", active_ids)
        self.assertNotIn("HATHOR-DOSE-002", active_ids)

    def test_all_results_property_includes_both_sets(self):
        ctx = _ctx()
        rec = _rec(antigen="MMR", dose_number=None, kind="catchup_visit", rec_id="rec-001")
        output = gate([rec], ctx)
        total = len(output.all_results)
        self.assertEqual(total, len(output.active) + len(output.superseded))

    def test_empty_recommendations_list(self):
        ctx = _ctx()
        output = gate([], ctx)
        self.assertEqual(output.active, [])
        self.assertEqual(output.superseded, [])
        self.assertFalse(output.has_failures)

    def test_has_override_required_true_when_override_required_present(self):
        """gate() sets has_override_required=True when any active result is override_required."""
        from hathor.safety import phase_e as pe_mod

        def _fake_override_required_rule(rec, ctx):
            return ValidationResult(
                recommendation_id=rec.recommendation_id,
                severity="override_required",
                rule_id="HATHOR-AGE-003",
                rule_slug="rotavirus_age_cutoff",
                rule_rationale="High-burden origin — override_required.",
                override_justification_codes=["HIGH_BURDEN_ORIGIN"],
            )

        original = pe_mod._RULE_REGISTRY[:]
        try:
            pe_mod._RULE_REGISTRY = [_fake_override_required_rule]
            ctx = _ctx()
            rec = _rec(antigen="Rotavirus", dose_number=1, kind="dose_verdict",
                       source_dose_indices=[0], rec_id="rec-or")
            output = gate([rec], ctx)
        finally:
            pe_mod._RULE_REGISTRY = original

        self.assertTrue(output.has_override_required)
        self.assertFalse(output.has_failures)  # override_required ≠ fail

    def test_has_override_required_false_when_none_present(self):
        """gate() sets has_override_required=False when no active result is override_required."""
        ctx = _ctx()
        rec = _rec(antigen="MMR", dose_number=None, kind="catchup_visit", rec_id="rec-001")
        output = gate([rec], ctx)
        self.assertFalse(output.has_override_required)

    def test_rotavirus_high_burden_triggers_override_required_in_gate(self):
        """End-to-end: gate() with high-burden Nigeria source → has_override_required=True."""
        from hathor.safety import phase_e as pe_mod
        ctx = ClinicalContext(
            child_dob=date(2024, 1, 1),
            target_country="Egypt",
            source_country="Nigeria",
            confirmed_doses=[
                {"antigen": "Rotavirus", "date_administered": "2024-04-15", "dose_number": 1}
            ],
        )
        rec = _rec(antigen="Rotavirus", dose_number=1, kind="dose_verdict",
                   source_dose_indices=[0], rec_id="rec-rota-nigeria")
        # Isolate to just the rotavirus rule to avoid noise
        original = pe_mod._RULE_REGISTRY[:]
        try:
            pe_mod._RULE_REGISTRY = [pe_mod._rule_rotavirus_age_cutoff]
            output = gate([rec], ctx)
        finally:
            pe_mod._RULE_REGISTRY = original

        self.assertTrue(output.has_override_required)
        self.assertFalse(output.has_failures)


# ── Integration — end-to-end emit_recommendations → Phase E ──────────────────


class TestEmitRecommendationsIntegration(unittest.TestCase):
    """Simulate a realistic agent emission flow for dose_verdict and confirm that
    Phase E routes the HATHOR-AGE-003 rotavirus-cutoff case to override_required
    when the agent populates source_dose_indices per the tool contract.

    Regression guard: an emission that omits source_dose_indices causes every
    dose-aware rule to silently return None, which bypasses the Friction by Design
    override_required pathway. This is the exact failure mode the smoke test
    surfaced; this test pins the contract so it cannot regress.

    Completeness fixture: these tests exercise the full emit_recommendations
    boundary, which now runs ``_check_emission_completeness`` before ``gate()``.
    The fixture confirmed_doses list below carries enough antigens — a Nigerian
    NPI-complete record — to satisfy every entry in
    ``REQUIRED_COMPONENT_ANTIGENS``. Tests that want to probe completeness
    violations should build their own minimal fixtures.
    """

    # A Nigerian NPI-complete dose list — covers every REQUIRED_COMPONENT_ANTIGEN
    # via Pentavalent (Diphtheria, Tetanus, Pertussis, HepB, Hib), OPV (Polio),
    # BCG, Measles monovalent, and Rotavirus. Mumps + Rubella are not routinely
    # given in Nigeria NPI — tests that rely on this fixture include an explicit
    # Measles dose as the antigen and treat the Mumps/Rubella requirement as
    # satisfied via the Measles token only if MMR is also present. The fixture
    # below includes MMR to close that gap for completeness-compliant tests.
    _NPI_COMPLETE_DOSES: list[dict] = [
        {"antigen": "BCG",         "date_administered": "2024-01-02", "dose_number": 1},
        {"antigen": "HepB",        "date_administered": "2024-01-02", "dose_number": 1},
        {"antigen": "OPV",         "date_administered": "2024-01-02", "dose_number": 1},
        {"antigen": "Pentavalent", "date_administered": "2024-02-12", "dose_number": 1},
        {"antigen": "OPV",         "date_administered": "2024-02-12", "dose_number": 2},
        {"antigen": "Pentavalent", "date_administered": "2024-03-11", "dose_number": 2},
        {"antigen": "OPV",         "date_administered": "2024-03-11", "dose_number": 3},
        {"antigen": "Pentavalent", "date_administered": "2024-04-08", "dose_number": 3},
        {"antigen": "IPV",         "date_administered": "2024-04-08", "dose_number": 1},
        {"antigen": "Measles",     "date_administered": "2024-10-01", "dose_number": 1},
        {"antigen": "MMR",         "date_administered": "2025-01-08", "dose_number": 1},
    ]

    def _invoke(self, payload: dict) -> dict:
        """Invoke the emit_recommendations tool handler synchronously and parse the
        JSON body out of the MCP-style wrapper."""
        import asyncio
        import json
        from hathor.tools.emit_recommendations import emit_recommendations

        response = asyncio.run(emit_recommendations.handler(payload))
        return json.loads(response["content"][0]["text"])

    def test_nigerian_rotavirus_past_cutoff_reaches_override_required(self):
        """Child DOB 2024-01-01, rotavirus dose 1 at 2024-05-01 (121 days = past the
        15-week ACIP cutoff), source_country Nigeria (high-burden). Agent emits a
        dose_verdict with source_dose_indices=[0]. Phase E must return
        override_required with HIGH_BURDEN_ORIGIN among the justification codes.

        Uses the NPI-complete fixture so the completeness check passes.
        """
        confirmed_doses = [
            {"antigen": "Rotavirus", "date_administered": "2024-05-01", "dose_number": 1},
            *self._NPI_COMPLETE_DOSES,
        ]
        payload = {
            "recommendations": [
                {
                    "recommendation_id": "rec-rota-1",
                    "kind": "dose_verdict",
                    "antigen": "Rotavirus",
                    "dose_number": 1,
                    "agent_rationale": "Rotavirus dose 1 given past the ACIP 15-week cutoff.",
                    "reasoning": "Administered at 121 days; ACIP cutoff is 105 days.",
                    "agent_confidence": 0.95,
                    "source_dose_indices": [0],
                },
            ],
            "clinical_context": {
                "child_dob": "2024-01-01",
                "target_country": "Egypt",
                "source_country": "Nigeria",
                "confirmed_doses": confirmed_doses,
            },
        }

        body = self._invoke(payload)

        self.assertNotIn("error", body, f"completeness should pass; got: {body}")
        self.assertTrue(body["has_override_required"], body)
        # HATHOR-AGE-003 must surface in active results with override_required severity
        age003 = [r for r in body["active_results"] if r["rule_id"] == "HATHOR-AGE-003"]
        self.assertEqual(len(age003), 1, f"expected one HATHOR-AGE-003 result; got: {body}")
        self.assertEqual(age003[0]["severity"], "override_required")
        self.assertIn("HIGH_BURDEN_ORIGIN", age003[0]["override_justification_codes"])

    def test_missing_source_dose_indices_leaves_rule_silent(self):
        """Contract regression: if a dose_verdict is submitted WITHOUT source_dose_indices,
        HATHOR-AGE-003's guard clause returns None and the override_required pathway is
        NOT reached. This is by design (defensive early-exit on malformed input) and
        is precisely why the agent prompt + tool description must require the field.

        This test pins that behavior so if we ever "fix" the guard to also fire on
        malformed input, the contract change is explicit."""
        confirmed_doses = [
            {"antigen": "Rotavirus", "date_administered": "2024-05-01", "dose_number": 1},
            *self._NPI_COMPLETE_DOSES,
        ]
        payload = {
            "recommendations": [
                {
                    "recommendation_id": "rec-rota-malformed",
                    "kind": "dose_verdict",
                    "antigen": "Rotavirus",
                    "dose_number": 1,
                    "agent_rationale": "Rotavirus dose 1 past cutoff (MISSING indices).",
                    "reasoning": "This emission omits source_dose_indices.",
                    "agent_confidence": 0.95,
                    # NOTE: source_dose_indices intentionally omitted
                },
            ],
            "clinical_context": {
                "child_dob": "2024-01-01",
                "target_country": "Egypt",
                "source_country": "Nigeria",
                "confirmed_doses": confirmed_doses,
            },
        }

        body = self._invoke(payload)
        self.assertNotIn("error", body, f"completeness should pass; got: {body}")
        # HATHOR-AGE-003 should be silent (no active result) when indices are missing
        age003 = [r for r in body["active_results"] if r["rule_id"] == "HATHOR-AGE-003"]
        self.assertEqual(len(age003), 0, "HATHOR-AGE-003 must not fire without source_dose_indices")


# ── Server-side emission completeness + ID namespace ownership ────────────────


class TestEmissionCompletenessAndIdNamespace(unittest.TestCase):
    """Exercises the two server-side enforcements added at the
    emit_recommendations boundary:

    1. **Emission completeness** — every disease in
       ``REQUIRED_COMPONENT_ANTIGENS`` must be covered by an emitted
       recommendation OR a confirmed dose (combination products expand to
       their components via COMBINATION_COMPONENTS + ANTIGEN_DISEASE_COVERAGE).
    2. **ID namespace ownership** — the server assigns a fresh UUID4 to each
       recommendation and preserves the agent-supplied id under ``agent_id``.
    """

    def _invoke(self, payload: dict) -> dict:
        import asyncio
        import json
        from hathor.tools.emit_recommendations import emit_recommendations

        response = asyncio.run(emit_recommendations.handler(payload))
        return json.loads(response["content"][0]["text"])

    def _full_payload(
        self,
        *,
        recommendations: list[dict],
        confirmed_doses: list[dict],
        source_country: str = "Nigeria",
    ) -> dict:
        return {
            "recommendations": recommendations,
            "clinical_context": {
                "child_dob": "2024-01-01",
                "target_country": "Egypt",
                "source_country": source_country,
                "confirmed_doses": confirmed_doses,
            },
        }

    # ── 1. Complete coverage via Nigerian-NPI-style combinations ─────────────

    def test_pentavalent_satisfies_diphtheria_tetanus_pertussis_hepb_hib(self):
        """Patient with Pentavalent x3, OPV, BCG, Measles, MMR, Rotavirus →
        DPT-components (Diphtheria/Tetanus/Pertussis), HepB, and Hib are
        satisfied by Pentavalent alone. Agent emits only Rotavirus. Completeness
        passes (no incomplete_emission error); Phase E runs normally."""
        doses = [
            {"antigen": "BCG",         "date_administered": "2024-01-02", "dose_number": 1},
            {"antigen": "Pentavalent", "date_administered": "2024-02-12", "dose_number": 1},
            {"antigen": "Pentavalent", "date_administered": "2024-03-11", "dose_number": 2},
            {"antigen": "Pentavalent", "date_administered": "2024-04-08", "dose_number": 3},
            {"antigen": "OPV",         "date_administered": "2024-01-02", "dose_number": 1},
            {"antigen": "Rotavirus",   "date_administered": "2024-02-12", "dose_number": 1},
            {"antigen": "Measles",     "date_administered": "2024-10-01", "dose_number": 1},
            {"antigen": "MMR",         "date_administered": "2025-01-08", "dose_number": 1},
        ]
        payload = self._full_payload(
            recommendations=[
                {
                    "recommendation_id": "rec-cover-check",
                    "kind": "due",
                    "antigen": "Rotavirus",
                    "dose_number": 2,
                    "agent_rationale": "Rotavirus dose 2 due soon.",
                    "reasoning": "Within schedule.",
                    "agent_confidence": 0.9,
                },
            ],
            confirmed_doses=doses,
        )
        body = self._invoke(payload)
        self.assertNotIn("error", body, body)
        self.assertIn("active_results", body)

    # ── 2. Missing Rotavirus (no confirmed dose) → incomplete_emission ──────

    def test_missing_rotavirus_without_dose_returns_incomplete_emission(self):
        """Pentavalent + OPV + BCG + MMR satisfy everything except Rotavirus.
        Agent omits Rotavirus. Server returns incomplete_emission with
        ``missing_antigens == ['Rotavirus']``."""
        doses = [
            {"antigen": "BCG",         "date_administered": "2024-01-02", "dose_number": 1},
            {"antigen": "Pentavalent", "date_administered": "2024-02-12", "dose_number": 1},
            {"antigen": "OPV",         "date_administered": "2024-02-12", "dose_number": 1},
            {"antigen": "Measles",     "date_administered": "2024-10-01", "dose_number": 1},
            {"antigen": "MMR",         "date_administered": "2025-01-08", "dose_number": 1},
        ]
        payload = self._full_payload(
            recommendations=[
                {
                    "recommendation_id": "rec-penta",
                    "kind": "dose_verdict",
                    "antigen": "Pentavalent",
                    "dose_number": 1,
                    "agent_rationale": "Pentavalent dose 1 valid.",
                    "reasoning": "Given at 42 days.",
                    "agent_confidence": 0.95,
                    "source_dose_indices": [1],
                },
            ],
            confirmed_doses=doses,
        )
        body = self._invoke(payload)
        self.assertEqual(body.get("error"), "incomplete_emission", body)
        self.assertEqual(body["missing_antigens"], ["Rotavirus"])
        self.assertIn("source_dose_indices=[]", body["message"])

    # ── 3. Missing Rotavirus emission but Rotavirus dose IS confirmed ──────

    def test_missing_rotavirus_emission_but_dose_present_passes(self):
        """Patient has a confirmed Rotavirus dose. Agent doesn't emit for
        Rotavirus. Completeness still passes — confirmed dose covers the
        requirement."""
        doses = [
            {"antigen": "BCG",         "date_administered": "2024-01-02", "dose_number": 1},
            {"antigen": "Pentavalent", "date_administered": "2024-02-12", "dose_number": 1},
            {"antigen": "OPV",         "date_administered": "2024-02-12", "dose_number": 1},
            {"antigen": "Rotavirus",   "date_administered": "2024-02-12", "dose_number": 1},
            {"antigen": "Measles",     "date_administered": "2024-10-01", "dose_number": 1},
            {"antigen": "MMR",         "date_administered": "2025-01-08", "dose_number": 1},
        ]
        payload = self._full_payload(
            recommendations=[
                {
                    "recommendation_id": "rec-penta",
                    "kind": "dose_verdict",
                    "antigen": "Pentavalent",
                    "dose_number": 1,
                    "agent_rationale": "Pentavalent dose 1 valid.",
                    "reasoning": "Given at 42 days.",
                    "agent_confidence": 0.95,
                    "source_dose_indices": [1],
                },
            ],
            confirmed_doses=doses,
        )
        body = self._invoke(payload)
        self.assertNotIn("error", body, body)

    # ── 4. Duplicate agent IDs → reassigned to unique server ids ────────────

    def test_duplicate_agent_recommendation_ids_get_unique_server_ids(self):
        """Agent emits two recs with the same recommendation_id; server assigns
        distinct UUID4s and preserves the agent id under agent_id on each
        result."""
        doses = [
            {"antigen": "BCG",         "date_administered": "2024-01-02", "dose_number": 1},
            {"antigen": "Pentavalent", "date_administered": "2024-02-12", "dose_number": 1},
            {"antigen": "OPV",         "date_administered": "2024-02-12", "dose_number": 1},
            {"antigen": "Rotavirus",   "date_administered": "2024-02-12", "dose_number": 1},
            {"antigen": "Measles",     "date_administered": "2024-10-01", "dose_number": 1},
            {"antigen": "MMR",         "date_administered": "2025-01-08", "dose_number": 1},
        ]
        payload = self._full_payload(
            recommendations=[
                {
                    "recommendation_id": "rec-dup",  # intentional duplicate
                    "kind": "dose_verdict",
                    "antigen": "Pentavalent",
                    "dose_number": 1,
                    "agent_rationale": "Pentavalent dose 1 valid.",
                    "reasoning": "Given at 42 days.",
                    "agent_confidence": 0.95,
                    "source_dose_indices": [1],
                },
                {
                    "recommendation_id": "rec-dup",  # same id — defect 2
                    "kind": "dose_verdict",
                    "antigen": "Rotavirus",
                    "dose_number": 1,
                    "agent_rationale": "Rotavirus dose 1 valid.",
                    "reasoning": "Given at 42 days.",
                    "agent_confidence": 0.95,
                    "source_dose_indices": [3],
                },
            ],
            confirmed_doses=doses,
        )
        body = self._invoke(payload)
        self.assertNotIn("error", body, body)

        # active_results contains one ValidationResult per (recommendation × rule)
        # that fired. Two input recs with the same agent id must resolve to TWO
        # distinct server-assigned recommendation_ids — the underlying defect
        # (React key collisions from duplicated ids) goes away as soon as the
        # set of distinct server ids equals the number of input recs.
        unique_server_ids = {r["recommendation_id"] for r in body["active_results"]}
        self.assertEqual(len(unique_server_ids), 2,
                         f"expected 2 distinct server ids; got: {unique_server_ids}")
        for r in body["active_results"]:
            self.assertIn("agent_id", r)
            self.assertEqual(r["agent_id"], "rec-dup")
        # Server ids must be UUID-shaped, not the agent-supplied "rec-dup"
        import re
        uuid_re = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
        for sid in unique_server_ids:
            self.assertIsNotNone(uuid_re.match(sid), f"not a UUID: {sid}")
            self.assertNotEqual(sid, "rec-dup")

    # ── 5. End-to-end retry loop simulation ──────────────────────────────────

    def test_agent_retry_loop_recovers_from_incomplete_emission(self):
        """First call omits Rotavirus → incomplete_emission. Simulated retry
        adds the missing Rotavirus recommendation. Second call succeeds and
        Phase E fires HATHOR-AGE-003 override_required for the gap-mode
        Rotavirus verdict."""
        doses = [
            {"antigen": "BCG",         "date_administered": "2024-01-02", "dose_number": 1},
            {"antigen": "Pentavalent", "date_administered": "2024-02-12", "dose_number": 1},
            {"antigen": "OPV",         "date_administered": "2024-02-12", "dose_number": 1},
            {"antigen": "Measles",     "date_administered": "2024-10-01", "dose_number": 1},
            {"antigen": "MMR",         "date_administered": "2025-01-08", "dose_number": 1},
        ]
        # First call — missing Rotavirus emission.
        first = self._invoke(self._full_payload(
            recommendations=[
                {
                    "recommendation_id": "rec-penta",
                    "kind": "dose_verdict",
                    "antigen": "Pentavalent",
                    "dose_number": 1,
                    "agent_rationale": "Pentavalent dose 1 valid.",
                    "reasoning": "Given at 42 days.",
                    "agent_confidence": 0.95,
                    "source_dose_indices": [1],
                },
            ],
            confirmed_doses=doses,
        ))
        self.assertEqual(first.get("error"), "incomplete_emission")
        self.assertIn("Rotavirus", first["missing_antigens"])

        # Simulated retry — agent adds the missing Rotavirus gap-mode
        # dose_verdict per the error guidance.
        second = self._invoke(self._full_payload(
            recommendations=[
                {
                    "recommendation_id": "rec-penta",
                    "kind": "dose_verdict",
                    "antigen": "Pentavalent",
                    "dose_number": 1,
                    "agent_rationale": "Pentavalent dose 1 valid.",
                    "reasoning": "Given at 42 days.",
                    "agent_confidence": 0.95,
                    "source_dose_indices": [1],
                },
                {
                    "recommendation_id": "rec-rota-gap",
                    "kind": "dose_verdict",
                    "antigen": "Rotavirus",
                    "dose_number": 1,
                    "agent_rationale": "No rotavirus dose on card; child past 15-week cutoff.",
                    "reasoning": "Nigerian origin migrant; high-burden pathway applies.",
                    "agent_confidence": 0.92,
                    "source_dose_indices": [],
                },
            ],
            confirmed_doses=doses,
        ))
        self.assertNotIn("error", second, second)
        self.assertTrue(second["has_override_required"], second)
        # The AGE-003 rule should fire on the gap-mode Rotavirus rec
        age003 = [r for r in second["active_results"] if r["rule_id"] == "HATHOR-AGE-003"]
        self.assertEqual(len(age003), 1)
        self.assertEqual(age003[0]["severity"], "override_required")

    # ── 6. Component satisfaction: Pentavalent covers 5, explicit Rotavirus/BCG/Polio/MMR emitted ──

    def test_component_satisfaction_pentavalent_covers_five_diseases(self):
        """Patient with Pentavalent x3 — no monovalent DPT/HepB/Hib emissions
        needed. Agent emits for Rotavirus only. Completeness passes because
        Pentavalent expands to DPT + HepB + Hib which covers Diphtheria,
        Tetanus, Pertussis, HepB, Hib at the disease level."""
        doses = [
            {"antigen": "BCG",         "date_administered": "2024-01-02", "dose_number": 1},
            {"antigen": "Pentavalent", "date_administered": "2024-02-12", "dose_number": 1},
            {"antigen": "Pentavalent", "date_administered": "2024-03-11", "dose_number": 2},
            {"antigen": "Pentavalent", "date_administered": "2024-04-08", "dose_number": 3},
            {"antigen": "OPV",         "date_administered": "2024-02-12", "dose_number": 1},
            {"antigen": "Rotavirus",   "date_administered": "2024-02-12", "dose_number": 1},
            {"antigen": "Measles",     "date_administered": "2024-10-01", "dose_number": 1},
            {"antigen": "MMR",         "date_administered": "2025-01-08", "dose_number": 1},
        ]
        payload = self._full_payload(
            recommendations=[
                {
                    "recommendation_id": "rec-rota",
                    "kind": "due",
                    "antigen": "Rotavirus",
                    "dose_number": 2,
                    "agent_rationale": "Rotavirus dose 2 due.",
                    "reasoning": "Within schedule.",
                    "agent_confidence": 0.9,
                },
            ],
            confirmed_doses=doses,
        )
        body = self._invoke(payload)
        self.assertNotIn("error", body, body)

    # ── 7. No DTP coverage — fails with DTP-related diseases in missing ─────

    def test_missing_dtp_reported_as_three_diseases(self):
        """Patient with no DTP/Pentavalent/Hexavalent. Completeness reports
        Diphtheria, Tetanus, and Pertussis (three diseases) as missing — the
        disease-level resolution visible to the agent."""
        doses = [
            {"antigen": "BCG",       "date_administered": "2024-01-02", "dose_number": 1},
            {"antigen": "OPV",       "date_administered": "2024-02-12", "dose_number": 1},
            {"antigen": "Rotavirus", "date_administered": "2024-02-12", "dose_number": 1},
            {"antigen": "HepB",      "date_administered": "2024-01-02", "dose_number": 1},
            {"antigen": "Hib",       "date_administered": "2024-02-12", "dose_number": 1},
            {"antigen": "MMR",       "date_administered": "2025-01-08", "dose_number": 1},
        ]
        payload = self._full_payload(
            recommendations=[
                {
                    "recommendation_id": "rec-bcg",
                    "kind": "dose_verdict",
                    "antigen": "BCG",
                    "dose_number": 1,
                    "agent_rationale": "BCG dose 1 valid.",
                    "reasoning": "Given within 30 days.",
                    "agent_confidence": 0.95,
                    "source_dose_indices": [0],
                },
            ],
            confirmed_doses=doses,
        )
        body = self._invoke(payload)
        self.assertEqual(body.get("error"), "incomplete_emission", body)
        self.assertEqual(
            set(body["missing_antigens"]),
            {"Diphtheria", "Tetanus", "Pertussis"},
            body,
        )

    # ── 8. MMR covers Measles / Mumps / Rubella ──────────────────────────────

    def test_mmr_covers_measles_mumps_rubella(self):
        """Patient with MMR confirmed. Agent emits no separate Measles/Mumps/
        Rubella recommendations. Completeness passes — MMR expansion covers
        all three disease-level requirements."""
        doses = [
            {"antigen": "BCG",         "date_administered": "2024-01-02", "dose_number": 1},
            {"antigen": "Pentavalent", "date_administered": "2024-02-12", "dose_number": 1},
            {"antigen": "OPV",         "date_administered": "2024-02-12", "dose_number": 1},
            {"antigen": "Rotavirus",   "date_administered": "2024-02-12", "dose_number": 1},
            {"antigen": "MMR",         "date_administered": "2025-01-08", "dose_number": 1},
        ]
        payload = self._full_payload(
            recommendations=[
                {
                    "recommendation_id": "rec-bcg",
                    "kind": "dose_verdict",
                    "antigen": "BCG",
                    "dose_number": 1,
                    "agent_rationale": "BCG dose 1 valid.",
                    "reasoning": "Given within 30 days.",
                    "agent_confidence": 0.95,
                    "source_dose_indices": [0],
                },
            ],
            confirmed_doses=doses,
        )
        body = self._invoke(payload)
        self.assertNotIn("error", body, body)


if __name__ == "__main__":
    unittest.main()
