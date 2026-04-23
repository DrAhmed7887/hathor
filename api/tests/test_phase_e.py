"""Tests for Phase E rules engine — 4 implemented rules.

Covers:
  HATHOR-AGE-001  min_age_valid           (dose_verdict + due/overdue paths)
  HATHOR-DOSE-001 max_dose_count
  HATHOR-DOSE-002 min_interval_met
  HATHOR-AGE-002  antigen_in_scope
  Stub rules      return None (no result)
  validate()      supersession engine
  gate()          has_failures flag

Stub rules (Q2/Q4/Q5/Q6/Q11) are tested only for None return — no bodies yet.
"""

import unittest
from datetime import date

from hathor.safety.phase_e import (
    ClinicalContext,
    PhaseEOutput,
    PHASE1_ANTIGENS,
    _rule_antigen_in_scope,
    _rule_max_dose_count,
    _rule_min_age_valid,
    _rule_min_interval_met,
    _stub_acip_grace_period,
    _stub_component_antigen_satisfaction,
    _stub_contraindication_source_conflict,
    _stub_live_vaccine_coadmin,
    _stub_rotavirus_age_cutoff,
    gate,
    validate,
)
from hathor.schemas.recommendation import Recommendation, ValidationResult


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


# ── Stub rules return None ────────────────────────────────────────────────────


class TestStubRulesReturnNone(unittest.TestCase):

    def setUp(self):
        self.rec = _rec()
        self.ctx = _ctx()

    def test_component_antigen_satisfaction_stub(self):
        self.assertIsNone(_stub_component_antigen_satisfaction(self.rec, self.ctx))

    def test_acip_grace_period_stub(self):
        self.assertIsNone(_stub_acip_grace_period(self.rec, self.ctx))

    def test_live_vaccine_coadmin_stub(self):
        self.assertIsNone(_stub_live_vaccine_coadmin(self.rec, self.ctx))

    def test_rotavirus_age_cutoff_stub(self):
        self.assertIsNone(_stub_rotavirus_age_cutoff(self.rec, self.ctx))

    def test_contraindication_source_conflict_stub(self):
        self.assertIsNone(_stub_contraindication_source_conflict(self.rec, self.ctx))


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


if __name__ == "__main__":
    unittest.main()
